import request from 'supertest';
import { app, server } from '../io';
import { prisma } from '../prisma';
import jwt from 'jsonwebtoken';

let driverToken, passengerToken;
let rideId;
let firstCommentId;

beforeAll(async () => {
    // Clean
    await prisma.rideComment.deleteMany();
    await prisma.ride.deleteMany();
    await prisma.user.deleteMany();

    // 1. Create Driver and Passenger
    const driver = await prisma.user.create({ data: { name: 'Comment Driver', email: 'c.driver@test.com', password: 'p', phone: '+2011COMMENTS' } });
    driverToken = jwt.sign({ userId: driver.id }, process.env.JWT_SECRET);
    
    const passenger = await prisma.user.create({ data: { name: 'Comment Passenger', email: 'c.passenger@test.com', password: 'p', phone: '+2022COMMENTS' } });
    passengerToken = jwt.sign({ userId: passenger.id }, process.env.JWT_SECRET);

    // 2. Create a Ride
    const ride = await prisma.ride.create({
        data: {
            origin: 'Q', destination: 'A', fromCity: 'QC', toCity: 'AC',
            originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2,
            time: new Date(Date.now() + 3600 * 1000), seats: 3, price: 10,
            driverId: driver.id, rideType: 'owner'
        }
    });
    rideId = ride.id;
});

afterAll((done) => {
    server.close(done);
});

describe('Comments API (/rides/:rideId/comments)', () => {

    it('should successfully POST a new top-level comment (201)', async () => {
        const response = await request(app)
            .post(`/rides/${rideId}/comments`)
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({ content: "Is there space for a small bag?" });

        expect(response.statusCode).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.content).toBe("Is there space for a small bag?");
        expect(response.body.parentId).toBeNull();
        firstCommentId = response.body.id; // Save for the reply test
    });

    it('should successfully POST a reply to an existing comment (201)', async () => {
        const response = await request(app)
            .post(`/rides/${rideId}/comments`)
            .set('Authorization', `Bearer ${driverToken}`) // Driver is replying
            .send({ 
                content: "Yes, of course!",
                parentId: firstCommentId // Linking to the first comment
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.content).toBe("Yes, of course!");
        expect(response.body.parentId).toBe(firstCommentId);
    });

    it('should GET all comments and their replies for the ride (200)', async () => {
        const response = await request(app)
            .get(`/rides/${rideId}/comments`)
            .set('Authorization', `Bearer ${passengerToken}`);

        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(1); // Only one top-level comment
        expect(response.body[0].id).toBe(firstCommentId);
        
        // Check for the reply within the top-level comment
        const firstComment = response.body[0];
        expect(Array.isArray(firstComment.replies)).toBe(true);
        expect(firstComment.replies.length).toBe(1);
        expect(firstComment.replies[0].content).toBe("Yes, of course!");
    });
});