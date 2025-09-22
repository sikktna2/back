import { prisma } from '../prisma';
import { processScheduledRides } from '../controllers/rideSchedulerController';

let verifiedDriver, unverifiedDriver, car;

beforeAll(async () => {
    // Clean
    await prisma.ride.deleteMany();
    await prisma.scheduledRide.deleteMany();
    await prisma.car.deleteMany();
    await prisma.user.deleteMany();

    // 1. Create a VERIFIED driver with a VERIFIED car
    verifiedDriver = await prisma.user.create({ 
        data: { name: 'Scheduler Driver', email: 's.driver@test.com', password: 'p', phone: '+2011SCHEDULER', isVerified: true } 
    });
    car = await prisma.car.create({ 
        data: { brand: 'Scheduler', model: 'Car', year: 2024, color: 'S', plate: 'S | 1', userId: verifiedDriver.id, isVerified: true } 
    });

    // 2. Create an UNVERIFIED driver
    unverifiedDriver = await prisma.user.create({ 
        data: { name: 'Unverified Scheduler', email: 's.unverified@test.com', password: 'p', phone: '+2022SCHEDULER', isVerified: false } 
    });

    // 3. Create scheduled rides for both
    const currentDayOfWeek = new Date().getUTCDay(); // 0 for Sunday, 1 for Monday...
    
    // Schedule for the verified driver
    await prisma.scheduledRide.create({
        data: {
            driverId: verifiedDriver.id,
            origin: 'Home', destination: 'Work', fromCity: 'Cairo', toCity: 'Cairo',
            originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
            seats: 2, price: 30,
            scheduleTime: '08:30',
            daysOfWeek: [currentDayOfWeek], // Scheduled for today
            isActive: true,
        }
    });

    // Schedule for the unverified driver
    await prisma.scheduledRide.create({
        data: {
            driverId: unverifiedDriver.id,
            origin: 'Point A', destination: 'Point B', fromCity: 'CityA', toCity: 'CityB',
            originLat: 3, originLng: 3, destinationLat: 4, destinationLng: 4,
            seats: 1, price: 20,
            scheduleTime: '09:00',
            daysOfWeek: [currentDayOfWeek],
            isActive: true,
        }
    });
});

describe('Ride Scheduler (Unit Test)', () => {

    it('should create a new Ride from an active schedule for a verified driver', async () => {
        // Run the cron job function manually
        await processScheduledRides();

        // Check the database for the newly created ride
        const createdRide = await prisma.ride.findFirst({
            where: { driverId: verifiedDriver.id }
        });

        expect(createdRide).not.toBeNull();
        expect(createdRide.origin).toBe('Home');
        expect(createdRide.price).toBe(30);
    });

    it('should NOT create a duplicate ride if the scheduler runs again', async () => {
        // The first run already happened in the previous test. Let's run it again.
        await processScheduledRides();

        // The count of rides for this driver should still be 1
        const ridesCount = await prisma.ride.count({
            where: { driverId: verifiedDriver.id }
        });
        expect(ridesCount).toBe(1);
    });

    it('should NOT create a ride for an unverified driver', async () => {
        // The scheduler was run in previous tests.
        // We just need to check that no ride was created for the unverified driver.
        const unverifiedRide = await prisma.ride.findFirst({
            where: { driverId: unverifiedDriver.id }
        });
        
        expect(unverifiedRide).toBeNull();
    });

});