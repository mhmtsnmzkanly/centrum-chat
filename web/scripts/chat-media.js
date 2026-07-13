import { store } from "./chat-store.js";

// Upload modal overlay (progress + success states), shared by the file-picker
// and fetch-from-URL upload paths.
export const UploadOverlay = {
  els() {
    return {
      container: document.getElementById("uploadStatusContainer"),
      progressBar: document.getElementById("uploadProgressBar"),
      progressPercent: document.getElementById("uploadProgressPercent"),
      workingState: document.querySelector(".upload-state-working"),
      successState: document.getElementById("uploadStateSuccess"),
      statusMsg: document.querySelector(".upload-status-message"),
    };
  },
  showWorking(message, percentLabel = "0%", width = "0%") {
    const els = this.els();
    if (!els.container) return false;
    els.container.classList.remove("d-none");
    els.workingState?.classList.remove("d-none");
    els.successState?.classList.add("d-none");
    if (els.statusMsg) els.statusMsg.textContent = message;
    if (els.progressBar) els.progressBar.style.width = width;
    if (els.progressPercent) els.progressPercent.textContent = percentLabel;
    return true;
  },
  setProgress(percent) {
    const els = this.els();
    if (els.progressBar) els.progressBar.style.width = `${percent}%`;
    if (els.progressPercent) els.progressPercent.textContent = `${percent}%`;
  },
  showSuccess() {
    const els = this.els();
    els.workingState?.classList.add("d-none");
    els.successState?.classList.remove("d-none");
  },
  hide() {
    this.els().container?.classList.add("d-none");
  },
};

export function destKeyForConversation(conversationId) {
  const chan = (store.get("channelList") || []).find((c) => c.id === conversationId);
  if (chan) return `channel_${chan.slug}`;
  const grp = (store.get("groupList") || []).find((g) => g.id === conversationId);
  if (grp) return `group_${grp.id}`;
  return `dm_${conversationId}`;
}

export function setupDragDropZone(handlers) {
  const dropZone = document.getElementById("dropZone");
  const modalFileInput = document.getElementById("modalFileInput");
  if (!dropZone) return;

  if (dropZone.dataset.dndReady) return;
  dropZone.dataset.dndReady = "1";

  const preventDefaults = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
    dropZone.addEventListener(eventName, preventDefaults);
  }
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, () => dropZone.classList.add("highlight"));
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove("highlight"));
  }

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handlers.modalUploadFile(file);
  });

  if (modalFileInput) {
    modalFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) handlers.modalUploadFile(file);
    };
  }
}
