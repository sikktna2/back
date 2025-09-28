// src/comments.js
import { prisma } from './prisma.js';
import { sendNotificationToUser } from './server.js';
import { io } from './io.js';

// Get all comments for a specific ride (with replies)
export const getRideComments = async (req, res) => {
  try {
    const { rideId } = req.params;
    const comments = await prisma.rideComment.findMany({
      where: {
        rideId: rideId,
        parentId: null, // Fetch only top-level comments
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        user: { // Include the author of the comment
          select: { id: true, name: true, profileImage: true },
        },
        replies: { // Include replies for each comment
          orderBy: {
            createdAt: 'asc',
          },
          include: {
            user: { // Include the author of the reply
              select: { id: true, name: true, profileImage: true },
            },
          },
        },
      },
    });
    res.json(comments);
  } catch (error) {
    console.error('Get ride comments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};

// Add a new comment or a reply to a ride
export const addRideComment = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { content, parentId } = req.body;
    const userId = req.user.userId;

    const newComment = await prisma.rideComment.create({
      data: {
        content,
        rideId,
        userId,
        parentId,
      },
      include: {
        user: { select: { id: true, name: true, profileImage: true } },
        replies: true, 
      }
    });

    // إرسال الحدث اللحظي للغرفة
    io.to(rideId).emit('new_ride_comment', newComment);

    // منطق إرسال الإشعارات (لم يتغير)
    if (!parentId) {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { driverId: true }
      });
      if (ride && ride.driverId !== userId) {
        await sendNotificationToUser(ride.driverId, {
  type: 'NEW_RIDE_COMMENT',
  relatedId: rideId,
  data: { userName: newComment.user.name },
});
      }
    } else {
      const parentComment = await prisma.rideComment.findUnique({
        where: { id: parentId },
        select: { userId: true }
      });
      if (parentComment && parentComment.userId !== userId) {
        await sendNotificationToUser(parentComment.userId, {
  type: 'NEW_COMMENT_REPLY',
  relatedId: rideId,
  data: { userName: newComment.user.name },
});
      }
    }
    
    res.status(201).json(newComment);
  } catch (error) {
    console.error('Add ride comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
};