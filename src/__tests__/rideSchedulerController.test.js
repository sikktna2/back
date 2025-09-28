import { prisma } from '../prisma.js';
import { processScheduledRides } from '../controllers/rideSchedulerController.js';


beforeEach(async () => {
    // Correct manual deletion order
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

describe('Ride Scheduler (Unit Test)', () => {
    it('should create a new Ride from an active schedule', async () => {
        const verifiedDriver = await prisma.user.create({ data: { name: 'Scheduler Driver', email: 's.driver@test.com', password: 'p', phone: `+2011${Date.now()}`, isVerified: true, isEmailVerified: true } });
        await prisma.car.create({ data: { brand: 'Scheduler', model: 'Car', year: 2024, color: 'S', plate: 'S | 1', userId: verifiedDriver.id, isVerified: true } });
        
        const currentDayOfWeek = new Date().getUTCDay();
        await prisma.scheduledRide.create({
            data: {
                driverId: verifiedDriver.id,
                origin: 'Home', destination: 'Work', fromCity: 'Cairo', toCity: 'Cairo',
                originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
                seats: 2, price: 30, scheduleTime: '23:55',
                daysOfWeek: [currentDayOfWeek], isActive: true,
            }
        });

        await processScheduledRides();

        const createdRide = await prisma.ride.findFirst({ where: { driverId: verifiedDriver.id } });
        expect(createdRide).not.toBeNull();
        expect(createdRide.origin).toBe('Home');
    });
});