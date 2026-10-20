import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy,
  limit, onSnapshot, serverTimestamp, addDoc, deleteDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const isAuthPage = Boolean($("authForm"));
let authMode = "login";
let currentUserData = null;
let unsubscribeMessages = null;
let unsubscribeStudents = null;
let unsubscribePinned = null;
let lastMessageIds = new Set();

function normalizeReg(value) { return value.trim().replace(/\s+/g, "").toUpperCase(); }
// Firebase Email/Password requires an email. A reserved, non-deliverable address maps
// each registration number to an Auth identity; students still sign in with their number.
function authEmail(reg) { return `${encodeURIComponent(normalizeReg(reg).toLowerCase())}@ssc26.class.invalid`; }
function displayError(error) {
  const messages = {
    "auth/invalid-credential": "Registration number or password is incorrect.",
    "auth/wrong-password": "Registration number or password is incorrect.",
    "auth/user-not-found": "Registration number or password is incorrect.",
    "auth/email-already-in-use": "This registration number already has an account. Please sign in.",
    "auth/weak-password": "Please choose a password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a little and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "permission-denied": "Access blocked by Firestore rules. Check the setup instructions."
  };
  return messages[error?.code] || "Something went wrong. Please try again.";
}

if (isAuthPage) {
  const form = $("authForm"), regInput = $("regNo"), password = $("password");
  const passwordWrap = $("passwordWrap"), confirmWrap = $("confirmWrap");
  const submit = $("submitAuth"), notice = $("authNotice");

  function setNotice(text, success = false) {
    notice.textContent = text; notice.className = `notice${success ? " success" : ""}`;
  }
  function setMode(mode) {
    authMode = mode;
    const registering = mode === "register";
    $("authHeading").textContent = registering ? "Welcome to the crew." : "Good to see you.";
    $("authSubcopy").textContent = registering
      ? "This registration number is approved. Create your password to join."
      : "Sign in with your school registration number.";
    passwordWrap.classList.remove("hidden");
    confirmWrap.classList.toggle("hidden", !registering);
    password.autocomplete = registering ? "new-password" : "current-password";
    password.required = true;
    $("confirmPassword").required = registering;
    submit.querySelector("span:first-child").textContent = registering ? "Create account" : "Sign in";
  }
  $("togglePassword").addEventListener("click", () => {
    password.type = password.type === "password" ? "text" : "password";
    $("togglePassword").textContent = password.type === "password" ? "Show" : "Hide";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reg = normalizeReg(regInput.value), pass = password.value;
    if (!reg) return setNotice("Enter your registration number.");
    if (pass.length < 6) return setNotice("Password must be at least 6 characters.");
    submit.disabled = true; setNotice("");
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail(reg), pass);
        // Auth state listener redirects after the account is verified.
      } else {
        if (pass !== $("confirmPassword").value) throw new Error("Passwords do not match.");
        // The allow-list must be verified by the trusted Cloud Function below.
        // Do not expose `allowedRegistrations` reads to unauthenticated clients.
        const check = await fetchRegistrationApproval(reg);
        if (!check.approved) throw new Error(check.message || "This registration number is not on the approved class list.");
        const credential = await createUserWithEmailAndPassword(auth, authEmail(reg), pass);
        const name = check.displayName || `Student ${reg}`;
        await updateProfile(credential.user, { displayName: name });
        await setDoc(doc(db, "users", credential.user.uid), {
          registrationNumber: reg, displayName: name, createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      setNotice(
        (error.message === "Passwords do not match." ||
         error.message === "This registration number is not on the approved class list." ||
         error.message === "This registration number has already been used. Please sign in.")
          ? error.message : displayError(error)
      );
    } finally {
      submit.disabled = false;
    }
  });

  // Calls a callable Cloud Function, keeping the allow-list private.
  async function fetchRegistrationApproval(reg) {
    const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js");
    const functions = getFunctions(app);
    const check = httpsCallable(functions, "checkRegistration");
    const result = await check({ registrationNumber: reg });
    return result.data;
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) location.replace("chat.html");
  });
} else {
  const messagesEl = $("messages"), messageInput = $("messageInput");
  const notice = $("chatNotice");
  function chatNotice(text) { notice.textContent = text; }
  function initials(name = "?") {
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0] || "").join("").toUpperCase() || "?";
  }
  function escapeText(text = "") {
    return text.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  }
  function timeLabel(timestamp) {
    if (!timestamp?.toDate) return "just now";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp.toDate());
  }
  function dateLabel(timestamp) {
    if (!timestamp?.toDate) return "Today";
    const d = timestamp.toDate(), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const yesterday = new Date(); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(d);
  }
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace("index.html"); return; }
    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (!profileSnap.exists()) {
        chatNotice("Your profile is missing. Please sign out and contact your class admin.");
        return;
      }
      currentUserData = { uid: user.uid, ...profileSnap.data() };
      $("myName").textContent = currentUserData.displayName || "Classmate";
      $("myReg").textContent = currentUserData.registrationNumber || "";
      $("myAvatar").textContent = initials(currentUserData.displayName);
      startStudents(); startMessages(); startPinned();
    } catch (e) { chatNotice(displayError(e)); }
  });

  function startStudents() {
    if (unsubscribeStudents) unsubscribeStudents();
    const q = query(collection(db, "users"), orderBy("displayName"), limit(300));
    unsubscribeStudents = onSnapshot(q, snap => {
      const students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      $("studentCount").textContent = students.length;
      renderStudents(students);
      $("studentSearch").oninput = () => renderStudents(students);
    }, e => { $("studentList").innerHTML = `<div class="loading-row">${escapeText(displayError(e))}</div>`; });
  }
  function renderStudents(students) {
    const term = $("studentSearch").value.toLowerCase().trim();
    const filtered = students.filter(s => (s.displayName || "").toLowerCase().includes(term) ||
      (s.registrationNumber || "").toLowerCase().includes(term));
    $("studentList").innerHTML = filtered.map(s => `
      <div class="student-row">
        <div class="student-avatar">${escapeText(initials(s.displayName))}</div>
        <div class="student-meta"><b>${escapeText(s.displayName || "Classmate")}</b><small>Reg. ${escapeText(s.registrationNumber || "—")}</small></div>
      </div>`).join("") || '<div class="loading-row">No classmates found.</div>';
  }
  function startMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    const q = query(collection(db, "rooms", "classroom", "messages"), orderBy("createdAt", "asc"), limit(300));
    unsubscribeMessages = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
      renderMessages(docs);
      if (wasNearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    }, e => chatNotice(displayError(e)));
  }
  function renderMessages(items) {
    if (!items.length) {
      messagesEl.innerHTML = `<div class="welcome-card"><div class="welcome-star">✦</div><h2>Welcome to the class group</h2><p>Say hello, share an update, or bring back a school memory.</p></div>`;
      return;
    }
    let html = "", lastDate = "";
    for (const m of items) {
      const day = dateLabel(m.createdAt);
      if (day !== lastDate) { html += `<div class="day-divider">${escapeText(day)}</div>`; lastDate = day; }
      const mine = m.senderUid === currentUserData?.uid;
      const reactions = m.reactions || {};
      const reactionButtons = ["👍","❤️","😂","🎉"].map(emoji => {
        const voters = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
        return `<button class="reaction-chip" data-action="react" data-id="${m.id}" data-emoji="${emoji}" title="React ${emoji}">${emoji}${voters.length ? ` ${voters.length}` : ""}</button>`;
      }).join("");
      html += `<article class="message-row ${mine ? "mine" : ""}" data-message="${m.id}">
        <div class="message-avatar">${escapeText(initials(m.senderName))}</div>
        <div class="message-content">
          <div class="message-author">${escapeText(m.senderName || "Classmate")} · ${escapeText(m.registrationNumber || "")}</div>
          <div class="bubble">${escapeText(m.text || "")}</div>
          <div class="message-meta"><span>${timeLabel(m.createdAt)}</span>${m.pinned ? '<span title="Pinned">⌁ Pinned</span>' : ""}</div>
          <div class="message-actions">${reactionButtons}
            ${mine || currentUserData?.isAdmin ? `<button class="tiny-action" data-action="pin" data-id="${m.id}">${m.pinned ? "Unpin" : "Pin"}</button>` : ""}
            ${mine || currentUserData?.isAdmin ? `<button class="tiny-action" data-action="delete" data-id="${m.id}">Delete</button>` : ""}
          </div>
        </div>
      </article>`;
    }
    messagesEl.innerHTML = html;
  }
  function startPinned() {
    if (unsubscribePinned) unsubscribePinned();
    const q = query(collection(db, "rooms", "classroom", "messages"), orderBy("createdAt", "desc"), limit(300));
    unsubscribePinned = onSnapshot(q, snap => {
      const pinned = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.pinned).slice(0, 1)[0];
      $("pinnedStrip").classList.toggle("hidden", !pinned);
      $("pinnedText").textContent = pinned?.text || "";
      $("clearPin").dataset.id = pinned?.id || "";
      $("clearPin").disabled = !pinned || !(pinned.senderUid === currentUserData?.uid || currentUserData?.isAdmin);
    }, e => chatNotice(displayError(e)));
  }
  $("messageForm").addEventListener("submit", async e => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUserData) return;
    $("sendMessage").disabled = true; chatNotice("");
    try {
      await addDoc(collection(db, "rooms", "classroom", "messages"), {
        text, senderUid: currentUserData.uid,
        senderName: currentUserData.displayName || "Classmate",
        registrationNumber: currentUserData.registrationNumber || "",
        createdAt: serverTimestamp(), pinned: false, reactions: {}
      });
      messageInput.value = ""; $("charCount").textContent = "0 / 2000"; messageInput.style.height = "auto";
    } catch (error) { chatNotice(displayError(error)); }
    finally { $("sendMessage").disabled = false; }
  });
  messageInput.addEventListener("input", () => {
    $("charCount").textContent = `${messageInput.value.length} / 2000`;
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
  });
  messageInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("messageForm").requestSubmit(); }
  });
  messagesEl.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id, emoji } = btn.dataset;
    const ref = doc(db, "rooms", "classroom", "messages", id);
    try {
      if (action === "react") {
        await runTransaction(db, async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const data = snap.data(), reactions = { ...(data.reactions || {}) };
          const users = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
          reactions[emoji] = users.includes(currentUserData.uid)
            ? users.filter(uid => uid !== currentUserData.uid) : [...users, currentUserData.uid];
          tx.update(ref, { reactions });
        });
      } else if (action === "pin" || action === "delete") {
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.senderUid !== currentUserData.uid && !currentUserData.isAdmin) {
          chatNotice("You can only manage your own messages."); return;
        }
        if (action === "pin") await updateDoc(ref, { pinned: !data.pinned, pinnedAt: !data.pinned ? serverTimestamp() : null });
        else if (confirm("Delete this message for everyone in the class?")) await deleteDoc(ref);
      }
    } catch (error) { chatNotice(displayError(error)); }
  });
  $("clearPin").addEventListener("click", async () => {
    const id = $("clearPin").dataset.id;
    if (!id) return;
    try {
      const ref = doc(db, "rooms", "classroom", "messages", id), snap = await getDoc(ref);
      if (snap.exists() && (snap.data().senderUid === currentUserData.uid || currentUserData.isAdmin)) {
        await updateDoc(ref, { pinned: false, pinnedAt: null });
      }
    } catch (e) { chatNotice(displayError(e)); }
  });
  $("signOut").addEventListener("click", async () => { await signOut(auth); });
  $("scrollLatest").addEventListener("click", () => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  $("openSidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
  $("closeSidebar").addEventListener("click", () => $("sidebar").classList.remove("open"));
}
