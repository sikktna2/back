import request from 'supertest';
import { app, server } from '../io';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

let verifiedUserToken, unverifiedUserToken;
let verifiedUserId, unverifiedUserId;
let verifiedCarId;
let testRideId;

// --- Helper function to create a user and car ---
const createUserAndCar = async (isVerified, hasCar, isCarVerified, userData) => {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const user = await prisma.user.create({
        data: {
            ...userData,
            password: hashedPassword,
            isVerified: isVerified,
            idVerificationStatus: isVerified ? 'APPROVED' : 'PENDING',
            isEmailVerified: true,
        },
    });

    let car = null;
    if (hasCar) {
        car = await prisma.car.create({
            data: {
                brand: 'Testla',
                model: 'Model T',
                year: 2025,
                color: 'Cyber-silver',
                plate: 'TEST | 123',
                userId: user.id,
                isVerified: isCarVerified,
                verificationStatus: isCarVerified ? 'APPROVED' : 'PENDING',
            },
        });
    }
    
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET);
    return { token, userId: user.id, carId: car?.id };
};


// --- Setup before all tests ---
beforeAll(async () => {
    // Clean database
    await prisma.booking.deleteMany();
    await prisma.ride.deleteMany();
    await prisma.car.deleteMany();
    await prisma.user.deleteMany();

    // Create a verified user with a verified car
    const verifiedData = await createUserAndCar(true, true, true, {
        name: 'Verified Driver',
        email: 'driver@test.com',
        password: 'password',
        phone: '+201111111111',
    });
    verifiedUserToken = verifiedData.token;
    verifiedUserId = verifiedData.userId;
    verifiedCarId = verifiedData.carId;

    // Create an unverified user
    const unverifiedData = await createUserAndCar(false, false, false, {
        name: 'Unverified User',
        email: 'passenger@test.com',
        password: 'password',
        phone: '+202222222222',
    });
    unverifiedUserToken = unverifiedData.token;
    unverifiedUserId = unverifiedData.userId;
});

afterAll((done) => {
    server.close(done);
});


// --- Test Suite for Rides API ---
describe('Rides API (/rides)', () => {

    it('should FAIL to create a ride for an unverified user (403)', async () => {
        const response = await request(app)
            .post('/rides')
            .set('Authorization', `Bearer ${unverifiedUserToken}`)
            .send({
                origin: 'Point A', destination: 'Point B', fromCity: 'CityA', toCity: 'CityB',
                originLat: 30.0, originLng: 31.0, destinationLat: 30.1, destinationLng: 31.1,
                time: new Date(Date.now() + 3600 * 1000).toISOString(),
                seats: 3, price: 50, isRequest: false, rideType: 'owner',
            });
        
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toContain('User must be verified');
    });

    it('should successfully CREATE a new ride for a verified user (201)', async () => {
        const rideTime = new Date(Date.now() + 2 * 3600 * 1000); // 2 hours from now
        const response = await request(app)
            .post('/rides')
            .set('Authorization', `Bearer ${verifiedUserToken}`)
            .send({
                origin: 'Nasr City', destination: 'Dokki', fromCity: 'Cairo', toCity: 'Giza',
                originLat: 30.05, originLng: 31.35, destinationLat: 30.03, destinationLng: 31.20,
                time: rideTime.toISOString(),
                seats: 3, price: 55, isRequest: false, rideType: 'owner', allowedGender: 'all'
            });

        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.price).toBe(55);
        testRideId = response.body.id; // Save for next tests
    });

    it('should FAIL to book a ride for the driver of the ride (400)', async () => {
        const response = await request(app)
            .post(`/rides/${testRideId}/book`)
            .set('Authorization', `Bearer ${verifiedUserToken}`) // Driver's token
            .send({ seats: 1 });
        
        expect(response.statusCode).toBe(400);
        expect(response.body.error).toContain('You cannot book your own ride');
    });

    it('should successfully BOOK a ride for a passenger (201)', async () => {
        const response = await request(app)
            .post(`/rides/${testRideId}/book`)
            .set('Authorization', `Bearer ${unverifiedUserToken}`) // Passenger's token
            .send({ seats: 2 });
        
        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('id'); // Booking ID
        expect(response.body.seatsBooked).toBe(2);
        expect(response.body.status).toBe('PENDING');
    });

    it('should FAIL to book more seats than available (400)', async () => {
        const response = await request(app)
            .post(`/rides/${testRideId}/book`)
            .set('Authorization', `Bearer ${unverifiedUserToken}`)
            .send({ seats: 2 }); // Only 1 seat left, trying to book 2

        expect(response.statusCode).toBe(400);
        expect(response.body.error).toContain('Not enough available seats');
    });
});