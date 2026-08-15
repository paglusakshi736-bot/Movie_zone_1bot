const Media = require('../models/Media');

/**
 * एडमिन को दिखाने के लिए डुप्लीकेट मूवीज़ ढूंढना
 */
async function getDuplicatesForReview() {
  try {
    const duplicates = await Media.aggregate([
      {
        $group: {
          _id: { cleanTitle: "$cleanTitle", type: "$type" },
          items: { $push: { id: "$_id", title: "$title", createdAt: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    return duplicates;
  } catch (error) {
    console.error('[Duplicate Review Error]:', error.message);
    return [];
  }
}

/**
 * एडमिन द्वारा ID से मूवी डिलीट करना
 */
async function deleteMediaById(mediaId) {
  try {
    const res = await Media.findByIdAndDelete(mediaId);
    return { success: true, title: res ? res.title : 'Unknown' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 1-क्लिक में सभी डुप्लीकेट एंट्रीज़ साफ़ करना (पहली कॉपी सुरक्षित रहेगी)
 */
async function cleanExactDuplicates() {
  try {
    const duplicates = await Media.aggregate([
      {
        $group: {
          _id: { cleanTitle: "$cleanTitle", type: "$type" },
          uniqueIds: { $addToSet: "$_id" },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    let removedCount = 0;

    for (const group of duplicates) {
      const idsToDelete = group.uniqueIds.slice(1);
      const res = await Media.deleteMany({ _id: { $in: idsToDelete } });
      removedCount += res.deletedCount;
    }

    return { success: true, removedCount };
  } catch (error) {
    console.error('[Duplicate Auto-Clean Error]:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getDuplicatesForReview,
  deleteMediaById,
  cleanExactDuplicates
};
