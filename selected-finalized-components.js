const ACCESS_CONFIG = {
  title: "Finalized Components Register",
  sessionKey: "selected-finalized-components-unlocked",
  passwordHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
  viewUrl: "https://docs.google.com/spreadsheets/d/1v1c5mhjtgMPaSKIibu6z3_qQMhuXcDJ2/edit?usp=sharing&ouid=115127239459401153262&rtpof=true&sd=true",
  downloadUrl: "https://docs.google.com/spreadsheets/d/1v1c5mhjtgMPaSKIibu6z3_qQMhuXcDJ2/export?format=xlsx",
};

const titleEl = document.getElementById("protected-title");
const statusEl = document.getElementById("protected-status");
const messageEl = document.getElementById("protected-message");
const formEl = document.getElementById("protected-form");
const passwordEl = document.getElementById("protected-password");
const actionsEl = document.getElementById("protected-actions");
const actionsTitleEl = document.getElementById("protected-actions-title");
const actionsNoteEl = document.getElementById("protected-actions-note");
const viewLinkEl = document.getElementById("view-workbook-link");
const downloadLinkEl = document.getElementById("download-workbook-link");

titleEl.textContent = ACCESS_CONFIG.title;

function setActionButtonState(linkEl, enabled, url) {
  linkEl.href = enabled ? url : "#";
  linkEl.setAttribute("aria-disabled", enabled ? "false" : "true");
  linkEl.tabIndex = enabled ? 0 : -1;
  linkEl.classList.toggle("is-disabled", !enabled);
}

function updateActionArea(unlocked, configured) {
  const enabled = unlocked && configured;
  actionsTitleEl.textContent = unlocked ? "Workbook access granted" : "Workbook access locked";
  actionsNoteEl.textContent = unlocked
    ? (configured
      ? "Use the actions below to open the shared file in Google Drive or download it to your device."
      : "Access is unlocked, but the workbook links still need to be configured.")
    : "Unlock the page to enable viewing or downloading the workbook.";
  setActionButtonState(viewLinkEl, enabled, ACCESS_CONFIG.viewUrl);
  setActionButtonState(downloadLinkEl, enabled, ACCESS_CONFIG.downloadUrl);
}

function isConfigured() {
  return !ACCESS_CONFIG.viewUrl.startsWith("REPLACE_WITH_") &&
    !ACCESS_CONFIG.downloadUrl.startsWith("REPLACE_WITH_");
}

function setLockedState(message) {
  statusEl.textContent = "Locked";
  messageEl.textContent = message;
  formEl.hidden = false;
  updateActionArea(false, isConfigured());
  sessionStorage.removeItem(ACCESS_CONFIG.sessionKey);
}

function setUnlockedState(configured) {
  statusEl.textContent = "Unlocked";
  messageEl.textContent = configured
    ? "Access granted. The workbook links are ready below."
    : "Access granted, but the Google Drive links still need to be added in selected-finalized-components.js.";
  formEl.hidden = true;
  updateActionArea(true, configured);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function unlockPage() {
  sessionStorage.setItem(ACCESS_CONFIG.sessionKey, "true");
  const configured = isConfigured();
  setUnlockedState(configured);
}

if (sessionStorage.getItem(ACCESS_CONFIG.sessionKey) === "true") {
  const configured = isConfigured();
  setUnlockedState(configured);
} else {
  setLockedState("This page is restricted. Enter the password below to continue.");
}

formEl.addEventListener("submit", async event => {
  event.preventDefault();
  const submittedPassword = passwordEl.value.trim();

  if (!submittedPassword) {
    setLockedState("Enter the password to continue.");
    return;
  }

  formEl.classList.add("is-busy");
  const submittedHash = await sha256(submittedPassword);
  formEl.classList.remove("is-busy");

  if (submittedHash !== ACCESS_CONFIG.passwordHash) {
    passwordEl.select();
    setLockedState("That password was not correct. Try again.");
    return;
  }

  passwordEl.value = "";
  unlockPage();
});

for (const linkEl of [viewLinkEl, downloadLinkEl]) {
  linkEl.addEventListener("click", event => {
    if (linkEl.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });
}
