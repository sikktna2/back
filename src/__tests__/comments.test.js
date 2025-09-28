import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';
import jwt from 'jsonwebtoken';

let driverToken, passengerToken, rideId, firstCommentId, driverId, passengerId;

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

    const driver = await prisma.user.create({ data: { name: 'Comment Driver', email: `c.driver@${Date.now()}test.com`, password: 'p', phone: `+201${Date.now()}` } });
    driverToken = jwt.sign({ userId: driver.id }, process.env.JWT_SECRET);
    driverId = driver.id; // Save the actual ID
    
    const passenger = await prisma.user.create({ data: { name: 'Comment Passenger', email: `c.passenger@${Date.now()}test.com`, password: 'p', phone: `+202${Date.now()}` } });
    passengerToken = jwt.sign({ userId: passenger.id }, process.env.JWT_SECRET);
    passengerId = passenger.id; // Save the actual ID

    const ride = await prisma.ride.create({
        data: {
            origin: "Q", destination: "A", fromCity: "QC", toCity: "AC", fromSuburb: "QS", toSuburb: "AS",
            originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
            time: new Date(Date.now() + 3600 * 1000), seats: 3, price: 10,
            driverId: driver.id, rideType: 'owner'
        }
    });
    rideId = ride.id;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Comments API (/rides/:rideId/comments)', () => {
    it('should successfully POST a new top-level comment (201)', async () => {
        const response = await request(server)
            .post(`/rides/${rideId}/comments`)
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({ content: "Is there space for a small bag?" });

        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('id');
        firstCommentId = response.body.id;
    });

    it('should successfully POST a reply to an existing comment (201)', async () => {
        const comment = await prisma.rideComment.create({
            data: { rideId: rideId, userId: passengerId, content: "Initial comment" }
        });

        const response = await request(server)
            .post(`/rides/${rideId}/comments`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ content: "Yes, of course!", parentId: comment.id });

        expect(response.statusCode).toBe(201);
        expect(response.body.parentId).toBe(comment.id);
    });
});