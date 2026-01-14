const fileInput = document.querySelector("#files");
const output = document.querySelector("#result");
const statusEl = document.querySelector("#uploadStatus");
const finalizeBtn = document.querySelector("#finalizeBtn");
const resetBtn = document.querySelector("#resetBtn");
const commentEl = document.querySelector("#comment");
const commentCountEl = document.querySelector("#commentCount");

const MAX_FILES = 2;
const MAX_BYTES = 1 * 1024 * 1024; // 1MB
const SIZE = 350;
const STORAGE_KEY = "catcode_gallery_submission_v1";

let pendingImages = []; // { id, name, dataUrl }
let isFinalized = false;

// ---------- Helpers ----------
function setStatus(msg) {
  statusEl.textContent = msg;
}

function countWords(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function updateWordCount() {
  const words = countWords(commentEl.value);
  commentCountEl.textContent = `${Math.min(words, 150)} / 150 words`;
  if (words > 150) {
    setStatus("Comment is over 150 words. Please shorten it.");
    finalizeBtn.disabled = true;
  } else {
    // enable finalize if we have 1-2 images and not finalized
    if (!isFinalized && pendingImages.length > 0) finalizeBtn.disabled = false;
    if (!isFinalized && pendingImages.length === 0) finalizeBtn.disabled = true;
  }
}

function validImageFile(file) {
  const isImage = file.type === "image/jpeg" || file.type === "image/png";
  if (!isImage) return { ok: false, reason: "Only JPG or PNG files are allowed." };
  if (file.size > MAX_BYTES) return { ok: false, reason: "Each image must be 1MB or less." };
  return { ok: true };
}

// Center-crop to 350x350 using canvas, then output JPEG dataUrl (smaller than PNG usually)
function cropToSquareDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read file."));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;

        const ctx = canvas.getContext("2d");
        // compute centered square crop
        const side = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - side) / 2);
        const sy = Math.floor((img.height - side) / 2);

        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

        // Use jpeg to keep size down. Quality 0.9 is usually fine.
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("That image file couldn’t be loaded."));
      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function renderPreviews() {
  output.innerHTML = "";

  // 1) Render image cards
  pendingImages.forEach((imgObj, index) => {
    const card = document.createElement("div");
    card.className = "preview-card";

    const img = document.createElement("img");
    img.className = "thumbnail";
    img.src = imgObj.dataUrl;
    img.alt = `Selected cat image ${index + 1}: ${imgObj.name}`;

    card.appendChild(img);

    // Delete button only before finalize
    if (!isFinalized) {
      const actions = document.createElement("div");
      actions.className = "preview-actions";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Delete";
      delBtn.setAttribute("aria-label", `Delete ${imgObj.name}`);
      delBtn.addEventListener("click", () => {
        pendingImages = pendingImages.filter((p) => p.id !== imgObj.id);
        setStatus("Image removed. You can choose a different one.");
        renderPreviews();
        updateFinalizeState();
      });

      actions.appendChild(delBtn);
      card.appendChild(actions);
    }

    output.appendChild(card);
  });

  // 2) Render ONE shared comment (optional) — only if there is a comment
  const commentText = commentEl.value.trim();
  if (commentText) {
    const commentBlock = document.createElement("div");
    commentBlock.className = "shared-comment";

    const heading = document.createElement("h3");
    heading.textContent = "Comment";

    const p = document.createElement("p");
    p.textContent = commentText;

    commentBlock.appendChild(heading);
    commentBlock.appendChild(p);

    output.appendChild(commentBlock);
  }
}


function updateFinalizeState() {
  const words = countWords(commentEl.value);
  if (isFinalized) {
    finalizeBtn.disabled = true;
    fileInput.disabled = true;
    commentEl.disabled = true;
    return;
  }

  // enable finalize only if we have 1-2 images AND comment <= 150 words
  finalizeBtn.disabled = !(pendingImages.length > 0 && pendingImages.length <= MAX_FILES && words <= 150);
}

// ---------- Load existing finalized submission ----------
(function initFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    if (parsed && parsed.finalized && Array.isArray(parsed.images)) {
      isFinalized = true;
      pendingImages = parsed.images;
      commentEl.value = parsed.comment || "";
      setStatus("Your gallery images have been finalized.");
      renderPreviews();
      updateWordCount();
      updateFinalizeState();
    }
  } catch {
    // ignore broken storage
  }
})();

// ---------- Events ----------
fileInput.addEventListener("change", async (e) => {
  if (isFinalized) return;

  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  // Don’t allow selecting more than remaining slots
  const slotsLeft = MAX_FILES - pendingImages.length;
  if (slotsLeft <= 0) {
    setStatus("You already selected 2 images. Delete one to add another.");
    fileInput.value = "";
    return;
  }

  // Only process up to slotsLeft
  const toProcess = files.slice(0, slotsLeft);

  for (const file of toProcess) {
    const check = validImageFile(file);
    if (!check.ok) {
      const msg = `${file.name}: ${check.reason}`;
      setStatus(msg);
      alert(msg);
      continue;
    }

    try {
      setStatus(`Processing ${file.name}...`);
      const dataUrl = await cropToSquareDataURL(file);

      pendingImages.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        name: file.name,
        dataUrl
      });

      setStatus("Image added. You can delete it before finalizing.");
    } catch (err) {
      setStatus(err.message || "Could not process that image.");
    }
  }

  // clear input so user can re-select same file later if needed
  fileInput.value = "";

  renderPreviews();
  updateFinalizeState();
});

commentEl.addEventListener("input", () => {
  // If user exceeds 150 words, we block finalize
  const words = countWords(commentEl.value);

  // Soft-limit: if they go over, don’t delete text, just disable finalize + message
  if (words > 150) {
    setStatus("Comment is over 150 words. Please shorten it.");
  } else if (!isFinalized) {
    setStatus("");
  }

  updateWordCount();
  updateFinalizeState();
});

finalizeBtn.addEventListener("click", () => {
  if (isFinalized) return;

  const words = countWords(commentEl.value);
  if (pendingImages.length === 0) {
    setStatus("Please select at least 1 image before submitting.");
    return;
  }
  if (pendingImages.length > MAX_FILES) {
    setStatus("Please keep only 2 images.");
    return;
  }
  if (words > 150) {
    setStatus("Please shorten your comment to 150 words or less.");
    return;
  }

  // Save finalized state
  const payload = {
    finalized: true,
    images: pendingImages,
    comment: commentEl.value.trim()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  isFinalized = true;
  setStatus("Submitted! Your images are now finalized and added to the gallery.");
  renderPreviews();
  updateFinalizeState();
});

resetBtn.addEventListener("click", () => {
  // Clear pending + storage (lets them start over)
  localStorage.removeItem(STORAGE_KEY);
  isFinalized = false;
  pendingImages = [];
  fileInput.disabled = false;
  commentEl.disabled = false;
  finalizeBtn.disabled = true;
  commentEl.value = "";
  fileInput.value = "";
  output.innerHTML = "";
  setStatus("Cleared. You can select up to 2 images again.");
  updateWordCount();
});

// Also keep word count correct on load
updateWordCount();
updateFinalizeState();
