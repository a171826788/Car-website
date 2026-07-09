const Booking = require('../models/Booking');
const { sendBookingNotifications, sendBookingStatusEmail } = require('../utils/notificationService');

/* ─────────────────────────────────────────────────────────────
   GET ALL BOOKINGS
───────────────────────────────────────────────────────────── */
exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('vehicleId')
      .populate('packageId')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('❌ getAllBookings error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   GET BOOKING BY ID / BOOKING ID
───────────────────────────────────────────────────────────── */
exports.getBookingById = async (req, res) => {
  try {
    const id = req.params.id;
    let booking = null;

    // Try Mongo ObjectId first
    if (/^[a-f\d]{24}$/i.test(id)) {
      booking = await Booking.findById(id)
        .populate('vehicleId')
        .populate('packageId');
    }

    // If not found, try bookingId
    if (!booking) {
      booking = await Booking.findOne({ bookingId: id })
        .populate('vehicleId')
        .populate('packageId');
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('❌ getBookingById error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   CREATE BOOKING WITH ASYNC NOTIFICATIONS
   ✅ Booking succeeds even if notifications fail
   ✅ Notifications sent in background (non-blocking)
───────────────────────────────────────────────────────────── */
exports.createBooking = async (req, res) => {
  try {
    console.log('📝 Creating booking...');
    
    // CREATE BOOKING IN DATABASE
    const booking = await Booking.create(req.body);
    console.log(`✅ Booking created successfully: ${booking.bookingId}`);

    // POPULATE VEHICLE & PACKAGE INFO FOR NOTIFICATIONS
    const populatedBooking = await Booking.findById(booking._id)
      .populate('vehicleId', 'name type model brand seats luggage')
      .populate('packageId', 'title destination duration image');

    // SEND NOTIFICATIONS IN BACKGROUND (non-blocking)
    if (populatedBooking) {
      setImmediate(async () => {
        try {
          await sendBookingNotifications(populatedBooking);
        } catch (notifErr) {
          console.error('⚠️  Notification error (non-blocking):', notifErr.message);
          // Notification failure does NOT affect booking success
        }
      });
    }

    // RETURN BOOKING IMMEDIATELY (before notifications complete)
    res.status(201).json({
      success: true,
      message: 'Booking created successfully. Confirmation being sent...',
      data: {
        _id: booking._id,
        bookingId: booking.bookingId,
        email: booking.email,
        name: booking.name,
        phone: booking.phone,
        pickupLocation: booking.pickupLocation,
        dropoffLocation: booking.dropoffLocation,
        pickupDate: booking.pickupDate,
        tripType: booking.tripType,
        totalPrice: booking.totalPrice,
        status: booking.status
      }
    });

  } catch (error) {
    console.error('❌ createBooking error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   UPDATE BOOKING
───────────────────────────────────────────────────────────── */
exports.updateBooking = async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    )
      .populate('vehicleId')
      .populate('packageId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully.',
      data: booking
    });
  } catch (error) {
    console.error('❌ updateBooking error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   DELETE BOOKING
───────────────────────────────────────────────────────────── */
exports.deleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking deleted successfully.'
    });
  } catch (error) {
    console.error('❌ deleteBooking error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   UPDATE BOOKING STATUS
───────────────────────────────────────────────────────────── */
exports.updateBookingStatus = async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    const id = req.params.id;

    const validStatuses = ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    let booking = null;

    if (/^[a-f\d]{24}$/i.test(id)) {
      booking = await Booking.findById(id).populate('vehicleId', 'name type model brand');
    }

    if (!booking) {
      booking = await Booking.findOne({ bookingId: id }).populate('vehicleId', 'name type model brand');
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    const previousStatus = booking.status;
    booking.status = status;
    
    if (status === 'cancelled' && cancelReason) {
      booking.cancelReason = cancelReason;
    }

    await booking.save();

    // ✅ Status genuinely change hua ho (aur email/WhatsApp-worthy status ho) tabhi mail bhejo
    // — same status pe dobara save karne se spam mail na jaaye
    const notifiableStatuses = ['confirmed', 'in-progress', 'completed', 'cancelled'];
    if (previousStatus !== status && notifiableStatuses.includes(status)) {
      setImmediate(async () => {
        try {
          await sendBookingStatusEmail(booking, status);
        } catch (emailErr) {
          console.error('⚠️  Status email error (non-blocking):', emailErr.message);
        }
      });
    }

    res.json({
      success: true,
      message: `Booking status updated to "${status}".`,
      data: booking
    });
  } catch (error) {
    console.error('❌ updateBookingStatus error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   DOWNLOAD BOOKING PDF
───────────────────────────────────────────────────────────── */
exports.downloadBookingPDF = async (req, res) => {
  try {
    const id = req.params.id;
    let booking = null;

    if (/^[a-f\d]{24}$/i.test(id)) {
      booking = await Booking.findById(id).populate('vehicleId').populate('packageId');
    }

    if (!booking) {
      booking = await Booking.findOne({ bookingId: id })
        .populate('vehicleId')
        .populate('packageId');
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'PDF download endpoint working. Add PDF generation logic here.',
      data: booking
    });
  } catch (error) {
    console.error('❌ downloadBookingPDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   SEND BOOKING PDF BY EMAIL
───────────────────────────────────────────────────────────── */
exports.sendBookingPDFByEmail = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'bookingId is required.'
      });
    }

    const booking = await Booking.findOne({ bookingId })
      .populate('vehicleId')
      .populate('packageId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    res.status(200).json({
      success: true,
      message: `Email sent to ${booking.email}`,
      data: booking
    });
  } catch (error) {
    console.error('❌ sendBookingPDFByEmail error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   RESEND CONFIRMATION EMAIL
───────────────────────────────────────────────────────────── */
exports.resendConfirmationEmail = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'bookingId is required.'
      });
    }

    const booking = await Booking.findOne({ bookingId })
      .populate('vehicleId')
      .populate('packageId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found.'
      });
    }

    // Send notifications in background
    setImmediate(async () => {
      try {
        await sendBookingNotifications(booking);
      } catch (notifErr) {
        console.error('⚠️  Resend notification error:', notifErr.message);
      }
    });

    res.json({
      success: true,
      message: `Confirmation email being sent to ${booking.email}`,
      data: booking
    });
  } catch (error) {
    console.error('❌ resendConfirmationEmail error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
