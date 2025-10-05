import { prisma } from '../prisma.js';
import { sendNotificationToUser } from '../server.js';

export const searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } }, // Allows searching by partial ID
        ],
        id: { not: req.user.userId }, // Exclude self from search results
      },
      select: { id: true, name: true, profileImage: true, city: true, isVerified: true },
      take: 10,
    });
    res.json(users);
  } catch (error) {
    next(error);
  }
};

export const sendFriendRequest = async (req, res, next) => {
  try {
    const requesterId = req.user.userId;
    const { addresseeId } = req.body;

    if (requesterId === addresseeId) {
      return res.status(400).json({ error: "You cannot add yourself as a friend." });
    }

    // ابحث عن أي علاقة صداقة قائمة بين المستخدمين
    const existingFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: requesterId, addresseeId: addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    let finalRequest;

    if (existingFriendship) {
      // إذا كانت العلاقة موجودة بالفعل
      if (existingFriendship.status === 'ACCEPTED' || existingFriendship.status === 'PENDING') {
        // إذا كانوا أصدقاء بالفعل أو هناك طلب معلق، امنع إرسال طلب جديد
        return res.status(409).json({ error: "A friend request already exists or you are already friends." });
      }
      
      // إذا كانت العلاقة مرفوضة، قم بتحديثها لإعادة إرسال الطلب
      finalRequest = await prisma.friendship.update({
        where: { id: existingFriendship.id },
        data: {
          requesterId: requesterId, // تأكد أن المرسل الحالي هو طالب الصداقة
          addresseeId: addresseeId,
          status: 'PENDING',
          updatedAt: new Date(), // تحديث وقت التعديل
        },
        include: { requester: { select: { name: true } } }
      });
      
    } else {
      // إذا لم تكن هناك أي علاقة سابقة، قم بإنشاء طلب جديد
      finalRequest = await prisma.friendship.create({
        data: { requesterId, addresseeId, status: 'PENDING' },
        include: { requester: { select: { name: true } } }
      });
    }

    // أرسل إشعارًا للمستخدم الآخر
    await sendNotificationToUser(addresseeId, {
      type: 'FRIEND_REQUEST',
      relatedId: finalRequest.id,
      data: { userName: finalRequest.requester.name },
    });

    // أرسل استجابة ناجحة
    // 201 للإنشاء الجديد، 200 للتحديث
    res.status(existingFriendship ? 200 : 201).json(finalRequest);

  } catch (error) {
    next(error);
  }
};

export const respondToFriendRequest = async (req, res, next) => {
  try {
    const { friendshipId } = req.params;
    const { action } = req.body;
    const currentUserId = req.user.userId;

    const friendship = await prisma.friendship.findFirst({
      where: { id: friendshipId, addresseeId: currentUserId, status: 'PENDING' },
      // **** START: MODIFICATION ****
      // Fetch the full user objects instead of just the name to be safer
      include: { requester: true, addressee: true },
      // **** END: MODIFICATION ****
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
        // Now friendship.addressee is guaranteed to exist
        await sendNotificationToUser(friendship.requesterId, {
            type: 'FRIEND_REQUEST_ACCEPTED',
            relatedId: currentUserId, // The ID of the user who accepted
            data: { userName: friendship.addressee.name }
        });
    }

    res.status(200).json(updatedFriendship);
  } catch (error) {
    next(error);
  }
};

export const getFriends = async (req, res, next) => {
  try {
    // *** The Fix: Read the userId from the URL parameter ***
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is missing from the URL." });
    }

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, name: true, profileImage: true, city: true, isVerified: true } },
        addressee: { select: { id: true, name: true, profileImage: true, city: true, isVerified: true } },
      },
    });

    const friends = friendships.map((f) => {
      return f.requesterId === userId ? f.addressee : f.requester;
    });

    res.status(200).json(friends);
  } catch (error) {
    next(error);
  }
};

// Get a single friendship request by its ID
export const getFriendRequest = async (req, res, next) => {
  try {
    const { friendshipId } = req.params;
    const request = await prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { requesterId: true } // We only need the ID of the person who sent it
    });
    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }
    res.status(200).json(request);
  } catch (error) {
    next(error);
  }
};

export const unfriend = async (req, res, next) => {
 const { friendId } = req.params;
const currentUserId = req.user.userId;

try {
  // ابحث عن علاقة الصداقة واحذفها بغض النظر عمن أرسل الطلب
  const deleteResult = await prisma.friendship.deleteMany({
    where: {
      status: 'ACCEPTED', // تأكد من أنهم أصدقاء بالفعل
      OR: [
        { requesterId: currentUserId, addresseeId: friendId },
        { requesterId: friendId, addresseeId: currentUserId },
      ],
    },
  });

  if (deleteResult.count === 0) {
    return res.status(404).json({ error: "Friendship not found." });
  }

  res.status(200).json({ message: "Friend removed successfully." });

} catch (error) {
  next(error);
}
};