const path = require("path");
const fs = require("fs");
const multer = require("multer");

const uploadsDir = path.join(__dirname, "data", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeExt = /^\.[a-zA-Z0-9]{1,5}$/.test(ext) ? ext : "";
    cb(null, `order-${req.params.id}-${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — generous for a phone photo/short clip
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only images (jpg/png/webp) or short videos (mp4/webm/mov) are allowed"));
    }
    cb(null, true);
  },
});

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

// Courier registration photo + Fayda ID photo — images only, no video, and no
// order id to key the filename off yet (registration hasn't created the row),
// so the filename is field name + timestamp + a random suffix instead.
const courierStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeExt = /^\.[a-zA-Z0-9]{1,5}$/.test(ext) ? ext : "";
    cb(null, `courier-${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const courierUpload = multer({
  storage: courierStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — a photo, not a video
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error("Only images (jpg/png/webp/heic) are allowed for the photo and Fayda ID upload"));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadsDir, courierUpload };
