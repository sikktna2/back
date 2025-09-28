import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';
import jwt from 'jsonwebtoken';

let driverToken, passengerToken;
let pendingBookingId;

beforeEach(async () => {
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
    const driver = await prisma.user.create({
        data: { name: 'Booking Driver', email: 'driver.booking@test.com', password: 'p', phone: `+2011${Date.now()}` }
    });
    driverToken = jwt.sign({ userId: driver.id }, process.env.JWT_SECRET);
    
    const passenger = await prisma.user.create({
        data: { name: 'Booking Passenger', email: 'passenger.booking@test.com', password: 'p', phone: `+2022${Date.now()}` }
    });
    passengerToken = jwt.sign({ userId: passenger.id }, process.env.JWT_SECRET);

    const ride = await prisma.ride.create({
        data: {
            origin: "A", destination: "B", fromCity: "AC", toCity: "BC", fromSuburb: "AS", toSuburb: "BS",
            originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
            time: new Date(Date.now() + 3600 * 1000), seats: 3, price: 10,
            driverId: driver.id, rideType: 'owner'
        }
    });

    const booking = await prisma.booking.create({
        data: { rideId: ride.id, userId: passenger.id, seatsBooked: 1, status: 'PENDING' }
    });
    pendingBookingId = booking.id;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Bookings API (/bookings)', () => {
    it('should successfully ACCEPT a pending booking by the driver (200)', async () => {
        const response = await request(server)
            .post(`/bookings/${pendingBookingId}/respond`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ action: 'accept' });

        expect(response.statusCode).toBe(200);
        expect(response.body.booking.status).toBe('ACCEPTED');
    });

    it('should FAIL to respond to an already accepted booking (400)', async () => {
        await prisma.booking.update({
            where: { id: pendingBookingId },
            data: { status: 'ACCEPTED' }
        });
        
        const response = await request(server)
            .post(`/bookings/${pendingBookingId}/respond`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ action: 'reject' });

        expect(response.statusCode).toBe(400);
    });
});