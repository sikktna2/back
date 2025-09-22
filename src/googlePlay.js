import { google } from 'googleapis';
import path from 'path';

const PLAY_API_SCOPES = ['https://www.googleapis.com/auth/androidpublisher'];
// استبدل 'your-key-file.json' باسم ملف الـ JSON الذي قمت بتحميله
const KEY_FILE_PATH = path.join(process.cwd(), 'your-key-file.json'); 

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE_PATH,
  scopes: PLAY_API_SCOPES,
});

const androidpublisher = google.androidpublisher({
  version: 'v3',
  auth: auth,
});

// هذه الدالة ستقوم بتأجيل الدفعة التالية للمستخدم لمدة شهر (جعله شهرًا مجانيًا)
export const grantFreeMonthReward = async (purchaseToken, subscriptionId, packageName) => {
  try {
    const subscription = await androidpublisher.purchases.subscriptions.get({
      packageName: packageName,
      subscriptionId: subscriptionId,
      token: purchaseToken,
    });

    const currentExpiry = new Date(parseInt(subscription.data.expiryTimeMillis, 10));
    const oneMonthLater = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + 1));

    await androidpublisher.purchases.subscriptions.defer({
      packageName: packageName,
      subscriptionId: subscriptionId,
      token: purchaseToken,
      requestBody: {
        deferralInfo: {
          expectedNewExpiryTimeMillis: oneMonthLater.getTime(),
          desiredSubscriptionOfferId: 'free-month-offer' // يجب تعريف هذا العرض في Play Console
        },
      },
    });
    console.log(`Successfully granted a free month for purchase: ${purchaseToken}`);
    return true;
  } catch (error) {
    console.error('Failed to grant free month via Google Play API:', error);
    throw new Error('Could not apply reward via Google Play.');
  }
};