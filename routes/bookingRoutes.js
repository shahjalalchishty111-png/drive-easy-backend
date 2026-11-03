const express = require("express");
const { client } = require("../db");

const router = express.Router();

const db = () => client.db("drive-easy");
const bookingsCollection = () => db().collection("bookings");
const carsCollection = () => db().collection("cars");

const DAY_MS = 86400000;
const SERVICE_FEE_RATE = 0.08; // 8% platform service fee

// GET /api/bookings  — ?user=<email> (customer) | ?owner=<email> (agency) | none (all/admin)
router.get("/", async (req, res) => {
  try {
    const { user, owner, status } = req.query;
    const filter = {};
    if (user) filter.userEmail = user;
    if (owner) filter.ownerEmail = owner;
    if (status) filter.status = status;

    const bookings = await bookingsCollection().find(filter).sort({ createdAt: -1 }).toArray();
    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch bookings", error: error.message });
  }
});

// POST /api/bookings  — create a booking. Price & duration are computed server-side.
router.post("/", async (req, res) => {
  try {
    const { carId, userEmail, userName, pickupDate, returnDate } = req.body;

    if (!carId || !userEmail || !pickupDate || !returnDate) {
      return res
        .status(400)
        .json({ message: "carId, userEmail, pickupDate and returnDate are required" });
    }

    const car = await carsCollection().findOne({ id: carId });
    if (!car) return res.status(404).json({ message: "Car not found" });
    if (!car.available) return res.status(409).json({ message: "This car is currently unavailable" });

    // Validate dates (date-only comparison, normalized to midnight).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pickupDay = new Date(pickupDate);
    pickupDay.setHours(0, 0, 0, 0);
    const returnDay = new Date(returnDate);
    returnDay.setHours(0, 0, 0, 0);

    if (Number.isNaN(pickupDay.getTime()) || Number.isNaN(returnDay.getTime())) {
      return res.status(400).json({ message: "Invalid pickup or return date" });
    }
    if (pickupDay < today) {
      return res.status(400).json({ message: "Pickup date cannot be in the past" });
    }
    if (returnDay <= pickupDay) {
      return res.status(400).json({ message: "Return date must be after the pickup date" });
    }

    const days = Math.round((returnDay - pickupDay) / DAY_MS);
    const subtotal = car.pricePerDay * days;
    const fee = Math.round(subtotal * SERVICE_FEE_RATE);

    const booking = {
      id: `BK-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      carId: car.id,
      carName: car.name,
      carImage: car.images?.[0] || null,
      userEmail,
      userName: userName || userEmail,
      ownerEmail: car.ownerEmail || null,
      pickupDate,
      returnDate,
      days,
      pricePerDay: car.pricePerDay,
      total: subtotal + fee,
      location: car.location,
      status: "upcoming",
      createdAt: new Date(),
    };

    const result = await bookingsCollection().insertOne(booking);
    res.status(201).json({ insertedId: result.insertedId, ...booking });
  } catch (error) {
    res.status(500).json({ message: "Failed to create booking", error: error.message });
  }
});

// PATCH /api/bookings/:id  — update status (e.g. cancel / mark active/completed)
router.patch("/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["upcoming", "active", "completed", "cancelled"];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const result = await bookingsCollection().updateOne(
      { id: req.params.id },
      { $set: { ...(status && { status }), updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "Booking not found" });
    res.status(200).json({ message: "Booking updated", modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: "Failed to update booking", error: error.message });
  }
});

// DELETE /api/bookings/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await bookingsCollection().deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Booking not found" });
    res.status(200).json({ message: "Booking deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete booking", error: error.message });
  }
});

module.exports = router;
