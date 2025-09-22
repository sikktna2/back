// src/badgeService.js
import { prisma } from './prisma.js';
// [MODIFICATION] Import the notification helper
import { sendNotificationToUser } from './server.js';

// --- Configuration ---
const MINIMUM_COMPLETED_RIDES_FOR_BADGES = 1;
const ON_TIME_START_THRESHOLD_MINUTES = 5;
// [MODIFICATION] Define the number of free rides required for a reward.
const FREE_RIDES_FOR_REWARD = 3;

/**
 * Ensures a UserStats record exists for a given user, creating one if not.
 * @param {string} userId The ID of the user.
 * @param {object} tx A Prisma transaction client (optional).
 * @returns {Promise<void>}
 */
const _ensureUserStats = async (userId, tx = prisma) => {
  await tx.userStats.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
};

/**
 * Updates user statistics after a ride is successfully completed.
 * Called from the end-ride logic.
 * @param {string} rideId The ID of the completed ride.
 * @param {object} tx A Prisma transaction client.
 * @returns {Promise<void>}
 */
export const updateStatsOnRideCompletion = async (rideId, tx) => {
  const ride = await tx.ride.findUnique({
    where: { id: rideId },
    include: {
      bookings: { where: { status: 'COMPLETED' } },
      driver: true,
    },
  });

  if (!ride || !ride.driver) return;

  const driverId = ride.driverId;
  await _ensureUserStats(driverId, tx);

  // --- Calculate stats for the DRIVER ---
  const statsUpdateData = {
    totalRidesAsDriver: { increment: 1 },
  };

  if (!ride.isTimeArranged && ride.time && ride.startedAt) {
    const differenceInMinutes = Math.abs((ride.startedAt.getTime() - ride.time.getTime()) / (1000 * 60));
    if (differenceInMinutes <= ON_TIME_START_THRESHOLD_MINUTES) {
      statsUpdateData.onTimeStarts = { increment: 1 };
    }
  }
  
  await tx.userStats.update({
    where: { userId: driverId },
    data: statsUpdateData,
  });

  // Add this line to update the main user model
  await tx.user.update({
    where: { id: driverId },
    data: { completedRides: { increment: 1 } },
  });

  // [MODIFICATION] Check if the completed ride was a free one offered by the driver.
  if (ride.price === 0 && ride.rideType === 'owner') {
    statsUpdateData.completedFreeRidesAsDriver = { increment: 1 };
  }

  const updatedStats = await tx.userStats.update({
    where: { userId: driverId },
    data: statsUpdateData,
    include: { user: true }, // Include user to check their reward eligibility
  });

  // [MODIFICATION] After updating stats, check if the driver is now eligible for a reward.
  if (
    ride.price === 0 &&
    ride.rideType === 'owner' &&
    updatedStats.completedFreeRidesAsDriver > 0 &&
    updatedStats.completedFreeRidesAsDriver % FREE_RIDES_FOR_REWARD === 0 &&
    !updatedStats.user.isEligibleForReward
  ) {
    // Make the user eligible for the reward
    await tx.user.update({
      where: { id: driverId },
      data: { isEligibleForReward: true },
    });
    // Send a notification to inform the driver
    await sendNotificationToUser(driverId, {
      title: 'مكافأة دعم المجتمع!',
      message: `شكراً لك! لقد أكملت ${FREE_RIDES_FOR_REWARD} رحلات مجانية. لقد حصلت على شهر مجاني كداعم للمجتمع.`,
      type: 'REWARD_ELIGIBLE',
      userId: driverId,
    });
  }
  // [END OF MODIFICATION]

  // --- Update stats for PASSENGERS ---
  for (const booking of ride.bookings) {
    await _ensureUserStats(booking.userId, tx);
    await tx.userStats.update({
      where: { userId: booking.userId },
      data: { totalRidesAsPassenger: { increment: 1 } },
    });
     await tx.user.update({
      where: { id: booking.userId },
      data: { completedRides: { increment: 1 } },
    });
  }
};

/**
 * Updates driver stats when they respond to a booking request.
 * @param {string} bookingId The ID of the booking.
 * @param {'ACCEPTED' | 'REJECTED'} action The action taken by the driver.
 * @param {object} tx A Prisma transaction client.
 * @returns {Promise<void>}
 */
export const updateStatsOnBookingResponse = async (booking, action, isFastResponse, tx) => {
    try {
        if (!booking || !booking.ride) return;
        
        const driverId = booking.ride.driverId;
        await _ensureUserStats(driverId, tx);

        const statsUpdateData = {
            totalBookingsToAccept: { increment: 1 },
            fastResponseOpportunities: { increment: 1 },
        };

        if (action === 'ACCEPTED' || action === 'ACCEPT') {
            statsUpdateData.acceptedBookings = { increment: 1 };
        }

        if (isFastResponse) {
            statsUpdateData.fastResponseSuccesses = { increment: 1 };
        }

        await tx.userStats.update({
            where: { userId: driverId },
            data: statsUpdateData,
        });

    } catch (error) {
        console.error('[BadgeService] CRITICAL ERROR during updateStatsOnBookingResponse:', error);
        throw error;
    }
};

/**
 * Updates user stats when a ride or booking is cancelled.
 * @param {string} cancelledByUserId The user who initiated the cancellation.
 * @param {object} tx A Prisma transaction client.
 * @returns {Promise<void>}
 */
export const updateStatsOnCancellation = async (cancelledByUserId, tx) => {
    await _ensureUserStats(cancelledByUserId, tx);
    await tx.userStats.update({
        where: { userId: cancelledByUserId },
        data: { totalCancellations: { increment: 1 } },
    });
};


/**
 * Calculates all badge percentages for a user and updates them in the database.
 * @param {string} userId The user's ID.
 * @param {object} tx A Prisma transaction client.
 * @returns {Promise<void>}
 */
export const calculateAndAssignBadges = async (userId, tx = prisma) => {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { stats: true },
  });

  if (!user || user.completedRides < MINIMUM_COMPLETED_RIDES_FOR_BADGES) {
    await tx.userBadge.deleteMany({
      where: { userId: userId }
    });
    return;
  }
  
  if (!user.stats) {
      return;
  }

  const stats = user.stats;
  const badges = await tx.badge.findMany();

  const badgeCalculations = {
  'High Acceptance': stats.totalBookingsToAccept > 0
    ? (stats.acceptedBookings / stats.totalBookingsToAccept) * 100
    : 100,
  'Low Cancellation': (stats.totalRidesAsDriver + stats.totalRidesAsPassenger) > 0
    ? 100 - ((stats.totalCancellations / (stats.totalRidesAsDriver + stats.totalRidesAsPassenger)) * 100)
    : 100,
  // تم تحديث معادلة الالتزام بالوقت لتعتمد على الإحصائيات الجديدة
  'Start On Time': stats.totalRidesAsDriver > 0
    ? (stats.onTimeStarts / stats.totalRidesAsDriver) * 100
    : 100,
  'Arrive On Eta': stats.totalRidesAsDriver > 0
    ? (stats.onTimeArrivals / stats.totalRidesAsDriver) * 100
    : 100,
  // تم تحديث معادلة سرعة الرد لتعتمد على الإحصائيات الجديدة
  'Fast Response': stats.fastResponseOpportunities > 0
    ? (stats.fastResponseSuccesses / stats.fastResponseOpportunities) * 100
    : 100,
  'Top Rated': user.rating > 0 ? (user.rating / 5) * 100 : 0,
  'First Ride': user.completedRides >= 1 ? 100 : 0,
  'Frequent Rider': user.completedRides > 0 ? (user.completedRides / 10) * 100 : 0,
};

  for (const badge of badges) {
    const progress = Math.max(0, Math.min(badgeCalculations[badge.name] ?? 0, 100));
    
    await tx.userBadge.upsert({
        where: {
            userId_badgeId: {
                userId: userId,
                badgeId: badge.id
            }
        },
        update: { progress },
        create: {
            userId: userId,
            badgeId: badge.id,
            progress: progress,
        }
    });
  }
};