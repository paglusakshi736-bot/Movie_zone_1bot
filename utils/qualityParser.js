/**
 * फ़ाइल नाम से क्वालिटी (480p, 720p, 1080p, 4K) पहचानना
 */
function extractQuality(filename) {
  if (!filename) return 'HD';
  const name = filename.toUpperCase();
  if (name.includes('2160P') || name.includes('4K')) return '4K';
  if (name.includes('1080P') || name.includes('FHD')) return '1080p';
  if (name.includes('720P') || name.includes('HD')) return '720p';
  if (name.includes('480P') || name.includes('SD')) return '480p';
  return 'HD';
}

module.exports = { extractQuality };
