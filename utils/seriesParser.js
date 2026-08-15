/**
 * फ़ाइल नाम से सीज़न और एपिसोड पहचानना
 */
function parseSeriesInfo(filename) {
  const cleanName = filename.replace(/[_\.\-]/g, ' ');
  
  const sPattern = /S(?:eason\s*)?(\d{1,2})\s*(?:E|EP|Episode\s*)(\d{1,3})/i;
  const epOnlyPattern = /(?:E|EP|Episode\s*)(\d{1,3})/i;

  const matchS = cleanName.match(sPattern);
  if (matchS) {
    return {
      isSeries: true,
      seasonNumber: parseInt(matchS[1]),
      episodeNumber: parseInt(matchS[2]),
      seriesTitle: cleanName.split(matchS[0])[0].trim()
    };
  }

  const matchEp = cleanName.match(epOnlyPattern);
  if (matchEp) {
    return {
      isSeries: true,
      seasonNumber: 1,
      episodeNumber: parseInt(matchEp[1]),
      seriesTitle: cleanName.split(matchEp[0])[0].trim()
    };
  }

  return { isSeries: false, seriesTitle: cleanName };
}

module.exports = { parseSeriesInfo };
