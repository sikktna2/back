import request from 'supertest';
import { server } from '../server.js';
import redisClient from '../redisClient.js';
import { prisma } from '../prisma.js';
import jwt from 'jsonwebtoken';

let verifiedUserToken, unverifiedUserToken, verifiedUserId;

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

    // Create users for tests
    const verifiedUser = await prisma.user.create({
        data: {
            name: 'Verified Driver', email: `driver-${Date.now()}@test.com`, password: 'p', phone: `+2011${Date.now()}`, 
            isVerified: true, idVerificationStatus: 'APPROVED', isEmailVerified: true
        }
    });
    verifiedUserId = verifiedUser.id;
    verifiedUserToken = jwt.sign({ userId: verifiedUserId }, process.env.JWT_SECRET);
    await prisma.car.create({
        data: { brand: 'Testla', model: 'T', year: 2025, color: 'Silver', plate: 'TEST | 123', userId: verifiedUserId, isVerified: true, verificationStatus: 'APPROVED' }
    });

    const unverifiedUser = await prisma.user.create({
        data: { name: 'Unverified Passenger', email: `passenger-${Date.now()}@test.com`, password: 'p', phone: `+2022${Date.now()}`, isVerified: false }
    });
    unverifiedUserToken = jwt.sign({ userId: unverifiedUser.id }, process.env.JWT_SECRET);
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (redisClient.isOpen) {
        await redisClient.quit();
    }
});

describe('Rides API (/rides)', () => {
    it('should FAIL to create a ride for an unverified user (403)', async () => {
        const response = await request(server)
            .post('/rides')
            .set('Authorization', `Bearer ${unverifiedUserToken}`)
            .send({
                origin: 'A', destination: 'B', fromCity: 'AC', toCity: 'BC', fromSuburb: 'AS', toSuburb: 'BS',
                originLat: 30, originLng: 31, destinationLat: 30.1, destinationLng: 31.1,
                time: new Date(Date.now() + 3600000).toISOString(), seats: 3, price: 50,
                isRequest: false, rideType: 'owner', allowedGender: 'all'
            });
        
        expect(response.statusCode).toBe(403);
    });

    it('should successfully CREATE a new ride for a verified user (201)', async () => {
        const response = await request(server)
            .post('/rides')
            .set('Authorization', `Bearer ${verifiedUserToken}`)
            .send({
                origin: 'Nasr City', destination: 'Dokki', fromCity: 'Cairo', toCity: 'Giza',
                fromSuburb: 'Nasr City', toSuburb: 'Dokki',
                originLat: 30.05, originLng: 31.35, destinationLat: 30.03, destinationLng: 31.20,
                time: new Date(Date.now() + 7200000).toISOString(), seats: 3, price: 55,
                isRequest: false, rideType: 'owner', allowedGender: 'all'
            });

        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('id');
    });
});