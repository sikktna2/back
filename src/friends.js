// src/friends.js
import { prisma } from './prisma.js';
import { sendNotificationToUser } from './server.js';

// Send a friend request
export const sendFriendRequest = async (req, res, next) => {
  try {
    const requesterId = req.user.userId;
    const { addresseeId } = req.body;

    if (requesterId === addresseeId) {
      return res.status(400).json({ error: "You cannot add yourself as a friend." });
    }

    const newRequest = await prisma.friendship.create({
      data: { requesterId, addresseeId, status: 'PENDING' },
      include: { requester: { select: { name: true } } }
    });

    await sendNotificationToUser(addresseeId, {
      type: 'FRIEND_REQUEST',
      relatedId: newRequest.id,
      data: { userName: newRequest.requester.name },
    });

    res.status(201).json(newRequest);
  } catch (error) {
    next(error);
  }
};

// Respond to a friend request
export const respondToFriendRequest = async (req, res, next) => {
  try {
    const { friendshipId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'
    const currentUserId = req.user.userId;

    const friendship = await prisma.friendship.findFirst({
      where: { id: friendshipId, addresseeId: currentUserId, status: 'PENDING' },
      include: { requester: { select: { name: true } } }
    });

    if (!friendship) {
      return res.status(404).json({ error: "Friend request not found or you don't have permission to respond." });
    }

    const newStatus = action === 'accept' ? 'ACCEPTED' : 'REJECTED';
    const updatedFriendship = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: newStatus },
    });
    
    if (newStatus === 'ACCEPTED') {
        await sendNotificationToUser(friendship.requesterId, {
            type: 'FRIEND_REQUEST_ACCEPTED',
            relatedId: currentUserId,
            data: { userName: friendship.addressee.name }
        });
    }

    res.status(200).json(updatedFriendship);
  } catch (error) {
    next(error);
  }
};

// Get a list of friends
export const getFriends = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const friendships = await prisma.friendship.findMany({
            where: {
                status: 'ACCEPTED',
                OR: [{ requesterId: userId }, { addresseeId: userId }],
            },
            include: {
                requester: true,
                addressee: true,
            },
        });

        // Extract the friend's data from the relationship
        const friends = friendships.map(f => {
            return f.requesterId === userId ? f.addressee : f.requester;
        });
        
        res.status(200).json(friends);
    } catch (error) {
        next(error);
    }
};