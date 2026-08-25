// Unambiguous alphabet — no 0/O/1/I — so codes read cleanly over a phone call.
const TRACKING_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateTrackingCode() {
  let code = "LDM-";
  for (let i = 0; i < 6; i++) {
    code += TRACKING_CHARS[Math.floor(Math.random() * TRACKING_CHARS.length)];
  }
  return code;
}

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

module.exports = { generateTrackingCode, generateOtp };
