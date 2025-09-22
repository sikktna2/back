import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import { PrismaClient, VerificationStatus, RideStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function createRideWithGeo(rideData) {
  return prisma.$transaction(async (tx) => {
    const ride = await tx.ride.create({
      data: rideData,
    });
    await tx.$executeRaw`
      UPDATE "Ride"
      SET 
        "originGeom" = ST_SetSRID(ST_MakePoint(${rideData.originLng}, ${rideData.originLat}), 4326)::geography,
        "destinationGeom" = ST_SetSRID(ST_MakePoint(${rideData.destinationLng}, ${rideData.destinationLat}), 4326)::geography
      WHERE id = ${ride.id};
    `;
    console.log(`Created ride from ${ride.fromCity} to ${ride.toCity}`);
    return ride;
  });
}

async function main() {
  console.log('Starting seed...');

  try {
    // Deleting old data in the correct order
    await prisma.message.deleteMany().catch(() => {});
    await prisma.chatMember.deleteMany().catch(() => {});
    await prisma.chat.deleteMany().catch(() => {});
    await prisma.booking.deleteMany().catch(() => {});
    await prisma.offer.deleteMany().catch(() => {});
    await prisma.feedback.deleteMany().catch(() => {});
    await prisma.notification.deleteMany().catch(() => {});
    await prisma.rideInterest.deleteMany().catch(() => {});
    await prisma.ride.deleteMany().catch(() => {});
    await prisma.userBadge.deleteMany().catch(() => {});
    await prisma.badge.deleteMany().catch(() => {});
    await prisma.carLicenseHistory.deleteMany().catch(() => {});
    await prisma.car.deleteMany().catch(() => {});
    await prisma.appConfig.deleteMany().catch(() => {});
    await prisma.referral.deleteMany().catch(() => {});
    await prisma.userStats.deleteMany().catch(() => {});
    await prisma.report.deleteMany().catch(() => {}); // Also good to clear reports
    
    // *** MODIFICATION: Added the missing deleteMany for AdminLastVisit ***
    await prisma.adminLastVisit.deleteMany().catch(() => {});

    await prisma.user.deleteMany().catch(() => {});

    console.log('Deleted old data.');
  } catch (error) {
    console.log('Some tables may not exist yet, continuing with seed...');
  }

  const configData = [
    { key: 'INSTAPAY_INFO', value: 'Bank: CIB - Account: 1234567890' },
    { key: 'VODAFONE_CASH_NUMBER', value: '01012345678' },
    { key: 'ORANGE_CASH_NUMBER', value: '0123456789' },
    { key: 'RIDE_DATE_WINDOW_DAYS', value: '2' } 
  ];

  for (const config of configData) {
    await prisma.appConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: { key: config.key, value: config.value },
    });
  }
  console.log('Created/Updated app config');

  const badgeData = [
     { name: 'Start On Time', description: 'Starts rides punctually', icon: '⏰', threshold: 80 },
    { name: 'Arrive On Eta', description: 'Arrives at destination on time', icon: '🏁', threshold: 80 },
    { name: 'Low Cancellation', description: 'Rarely cancels rides or bookings', icon: '👍', threshold: 90 },
    { name: 'High Acceptance', description: 'Accepts a high percentage of ride requests', icon: '✅', threshold: 85 },
    { name: 'Fast Response 5m', description: 'Typically responds to messages within 5 minutes', icon: '⚡️', threshold: 80 },
    { name: 'Fair Price', description: 'Offers fair prices for rides', icon: '💰', threshold: 90 },
];
  await prisma.badge.createMany({ data: badgeData });
  console.log('Created badges');

  // Create Users
  const adminHash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.create({
    data: {
      id: "clxza3o7b000014mhmu4tq5z9",
      name: 'Admin User',
      email: 'admin@example.com',
      password: adminHash,
      phone: '+201000000001',
      isVerified: true,
      isPremium: true,
      city: 'Cairo',
      hasSeenOnboarding: true,
      preferredLanguage: 'en',
      darkMode: false,
      idVerificationStatus: VerificationStatus.APPROVED,
      role: 'ADMIN',
      isEmailVerified: true,
    }
  });
  
  const user1Hash = await bcrypt.hash('user123', 12);
  const user1 = await prisma.user.create({
    data: {
      name: 'Ahmed Zaki',
      email: 'ahmed@example.com',
      password: user1Hash,
      phone: '+201000000002',
      isVerified: true,
      isPremium: true,
      city: 'Cairo',
      gender: 'male',
      birthDate: new Date('1995-05-15'),
      profileImage: 'https://i.pravatar.cc/150?u=mona',
      rating: 4.8,
      completedRides: 15,
      hasSeenOnboarding: true,
      preferredLanguage: 'ar',
      darkMode: true,
      idFrontImageUrl: 'https://example.com/id_front.jpg',
      idBackImageUrl: 'https://example.com/id_back.jpg',
      drivingLicenseUrl: 'https://example.com/driving_license.jpg',
      idVerificationStatus: VerificationStatus.APPROVED,
      isEmailVerified: true,
    }
  });

  const user2Hash = await bcrypt.hash('user123', 12);
  const user2 = await prisma.user.create({
    data: {
      name: 'Mona Ali',
      email: 'mona@example.com',
      password: user2Hash,
      phone: '+201000000003',
      isVerified: true,
      isPremium: true,
      city: 'Cairo',
      gender: 'male',
      birthDate: new Date('1995-05-15'),
      profileImage: 'https://i.pravatar.cc/150?u=mona',
      rating: 4.8,
      completedRides: 15,
      hasSeenOnboarding: true,
      preferredLanguage: 'ar',
      darkMode: true,
      idFrontImageUrl: 'https://example.com/id_front.jpg',
      idBackImageUrl: 'https://example.com/id_back.jpg',
      drivingLicenseUrl: 'https://example.com/driving_license.jpg',
      idVerificationStatus: VerificationStatus.APPROVED,
      isEmailVerified: true,
    }
  });

   const user3 = await prisma.user.create({
    data: {
      name: 'Omar Hassan',
      email: 'omar@example.com',
      password: await bcrypt.hash('user123', 12),
      phone: '+201000000004',
      isVerified: true,
      isPremium: true,
      city: 'Cairo',
      gender: 'male',
      birthDate: new Date('1995-05-15'),
      profileImage: 'https://i.pravatar.cc/150?u=mona',
      rating: 4.8,
      completedRides: 15,
      hasSeenOnboarding: true,
      preferredLanguage: 'ar',
      darkMode: true,
      idFrontImageUrl: 'https://example.com/id_front.jpg',
      idBackImageUrl: 'https://example.com/id_back.jpg',
      drivingLicenseUrl: 'https://example.com/driving_license.jpg',
      idVerificationStatus: VerificationStatus.APPROVED,
      isEmailVerified: true,
    }
  });

  console.log('Created users');

  // Create Cars
  const car1 = await prisma.car.create({
    data: {
      brand: 'Toyota', model: 'Corolla', year: 2020, color: 'Red', plate: 'س ص ع | 1234',
      licensePhoto: 'https://example.com/license1.jpg', isVerified: true, userId: user1.id,
      verificationStatus: VerificationStatus.APPROVED,
      licenseExpiryDate: new Date('2026-08-31T22:00:00.000Z')
    }
  });
  
  const car2 = await prisma.car.create({
    data: {
      brand: 'Hyundai', model: 'Elantra', year: 2019, color: 'Blue', plate: 'أ ب ج | 5678',
      licensePhoto: 'https://example.com/license2.jpg', isVerified: false, userId: user2.id,
      verificationStatus: VerificationStatus.NOT_SUBMITTED,
      licenseExpiryDate: new Date('2025-01-15T22:00:00.000Z')
    }
  });
  console.log('Created cars');

  // Create Rides 
  const now = new Date();
  
  await createRideWithGeo({
    driverId: user1.id, carId: car1.id,
    origin: 'Nasr City, Cairo', destination: 'Dokki, Giza',
    fromCity: 'Cairo', fromSuburb: 'Nasr City', toCity: 'Giza', toSuburb: 'Dokki',
    fromCityNorm: 'cairo', fromSuburbNorm: 'nasr city', toCityNorm: 'giza', toSuburbNorm: 'dokki',
    originLat: 30.0530, originLng: 31.3582,
    destinationLat: 30.0355, destinationLng: 31.2096,
    time: new Date(now.getTime() + 3 * 60 * 60 * 1000),
    seats: 3, price: 50, rideType: 'owner', status: RideStatus.UPCOMING,
    isAnonymous: false,
    etaMinutes: 45,
    allowedGender: 'all',
  });

  await createRideWithGeo({
    driverId: user2.id,
    origin: 'Maadi, Cairo', destination: 'New Cairo, Cairo',
    fromCity: 'Cairo', fromSuburb: 'Maadi', toCity: 'Cairo', toSuburb: 'New Cairo',
    fromCityNorm: 'cairo', fromSuburbNorm: 'maadi', toCityNorm: 'cairo', toSuburbNorm: 'new cairo',
    originLat: 29.9623, originLng: 31.2769,
    destinationLat: 30.0300, destinationLng: 31.4800,
    time: new Date(now.getTime() + 6 * 60 * 60 * 1000),
    seats: 2, price: 0, rideType: 'renter', status: RideStatus.UPCOMING,
    renterScreenshotUrl: 'https://example.com/renter_screenshot.jpg',
    serviceType: 'Uber',
    isAnonymous: false,
    etaMinutes: 35,
    allowedGender: 'female',
  });

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });