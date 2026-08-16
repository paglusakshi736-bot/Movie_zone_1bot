function parseSeriesDetails(fileName) {
  if (!fileName) return { isSeries: false, cleanTitle: '' };

  const seriesRegex = /(.*?)(?:s|season)\s*(\d{1,2})|(?:\be\d{1,2}\b)/i;
  const match = fileName.match(seriesRegex);

  if (match) {
    const cleanTitle = match[1] ? match[1].replace(/[._-]/g, ' ').trim() : fileName;
    return {
      isSeries: true,
      cleanTitle: cleanTitle
    };
  }

  return {
    isSeries: false,
    cleanTitle: fileName.replace(/[._-]/g, ' ').trim()
  };
}

module.exports = {
  parseSeriesDetails
};
