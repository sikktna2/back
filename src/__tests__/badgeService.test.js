import { prisma } from '../prisma.js';
import { updateStatsOnRideCompletion, calculateAndAssignBadges } from '../badgeService.js';

// Clean the DB before each test
beforeEach(async () => {
    // This is the correct, manual order to delete everything without constraint violations.
    await prisma.notification.deleteMany().catch(() => {});
    await prisma.message.deleteMany().catch(() => {});
    await prisma.chatMember.deleteMany().catch(() => {});
    await prisma.chat.deleteMany().catch(() => {});
    await prisma.booking.deleteMany().catch(() => {});
    await prisma.rideComment.deleteMany().catch(() => {});
    await prisma.feedback.deleteMany().catch(() => {});
    await prisma.rideInterest.deleteMany().catch(() => {});
    await prisma.report.deleteMany().catch(() => {});
    await prisma.userBadge.deleteMany().catch(() => {});
    await prisma.badge.deleteMany().catch(() => {});
    await prisma.ride.deleteMany().catch(() => {});
    await prisma.carLicenseHistory.deleteMany().catch(() => {});
    await prisma.car.deleteMany().catch(() => {});
    await prisma.referral.deleteMany().catch(() => {});
    await prisma.userStats.deleteMany().catch(() => {});
    await prisma.adminLastVisit.deleteMany().catch(() => {});
    await prisma.promoCode.deleteMany().catch(() => {});
    await prisma.savedRoute.deleteMany().catch(() => {});
    await prisma.scheduledRide.deleteMany().catch(() => {});
    // Delete users last
    await prisma.user.deleteMany().catch(() => {});
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('Badge Service (Unit Tests)', () => {
    it('should correctly update user stats after a ride completion', async () => {
        // --- Test-specific setup ---
        const driver = await prisma.user.create({ data: { name: 'D', email: 'd@t.com', password: 'p', phone: `+1${Date.now()}` } });
        const passenger = await prisma.user.create({ data: { name: 'P', email: 'p@t.com', password: 'p', phone: `+2${Date.now()}` } });
        const ride = await prisma.ride.create({
            data: {
                origin: 'A', destination: 'B', fromCity: 'C', toCity: 'D', fromSuburb: 'AS', toSuburb: 'BS',
                originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
                time: new Date(), seats: 2, price: 10, driverId: driver.id, rideType: 'owner',
                startedAt: new Date(Date.now() - 4 * 60 * 1000),
            }
        });
        await prisma.booking.create({
            data: { rideId: ride.id, userId: passenger.id, seatsBooked: 1, status: 'COMPLETED' }
        });
        // --- End of setup ---

        await prisma.$transaction(async (tx) => {
            await updateStatsOnRideCompletion(ride.id, tx);
        });

        const driverStats = await prisma.userStats.findUnique({ where: { userId: driver.id } });
        expect(driverStats.totalRidesAsDriver).toBe(1);
    });

    it('should correctly calculate and assign badge progress', async () => {
        // --- Test-specific setup ---
         const user = await prisma.user.create({ data: { name: 'U', email: `u-${Date.now()}@t.com`, password: 'p', phone: `+3${Date.now()}`, completedRides: 10 } });
        await prisma.userStats.create({
            data: {
                userId: user.id,
                acceptedBookings: 8,
                totalBookingsToAccept: 10
            }
        });
        await prisma.badge.create({ data: { name: 'High Acceptance', description: 'd', icon: 'i', threshold: 80 } });
        // --- End of setup ---

        await calculateAndAssignBadges(user.id);
        
        const userBadge = await prisma.userBadge.findFirst({ where: { userId: user.id } });
        expect(userBadge.progress).toBe(80);
    });
});