const express = require("express");
const { client } = require("../db");

const router = express.Router();

const carsCollection = () => client.db("drive-easy").collection("cars");

// GET /api/cars  — list with optional filters
//   ?q= &category= &available=true &minPrice= &maxPrice= &featured=true
//   &sort=featured|price-asc|price-desc|rating &owner=<email>
router.get("/", async (req, res) => {
  try {
    const { q, category, available, minPrice, maxPrice, featured, sort, owner } = req.query;
    const filter = {};

    if (category && category !== "All") filter.category = category;
    if (available === "true") filter.available = true;
    if (featured === "true") filter.featured = true;
    if (owner) filter.ownerEmail = owner;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { brand: { $regex: q, $options: "i" } },
      ];
    }
    if (minPrice || maxPrice) {
      filter.pricePerDay = {};
      if (minPrice) filter.pricePerDay.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerDay.$lte = Number(maxPrice);
    }

    const sortMap = {
      "price-asc": { pricePerDay: 1 },
      "price-desc": { pricePerDay: -1 },
      rating: { rating: -1 },
      featured: { featured: -1, rating: -1 },
    };

    const cars = await carsCollection()
      .find(filter)
      .sort(sortMap[sort] || sortMap.featured)
      .toArray();

    res.status(200).json(cars);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch cars", error: error.message });
  }
});

// GET /api/cars/:id  — single car by its stable string id
router.get("/:id", async (req, res) => {
  try {
    const car = await carsCollection().findOne({ id: req.params.id });
    if (!car) return res.status(404).json({ message: "Car not found" });
    res.status(200).json(car);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch car", error: error.message });
  }
});

// POST /api/cars  — add a car (agency)
router.post("/", async (req, res) => {
  try {
    const b = req.body;
    if (!b.name || !b.brand || !b.pricePerDay || !b.category) {
      return res.status(400).json({ message: "Name, brand, category and pricePerDay are required" });
    }

    const car = {
      id: `car-${Date.now()}`,
      name: b.name,
      brand: b.brand,
      category: b.category,
      badge: b.badge || "NEW",
      badgeColor: b.badgeColor || "blue",
      pricePerDay: Number(b.pricePerDay),
      rating: 0,
      reviewCount: 0,
      seats: Number(b.seats) || 4,
      range: b.range || "—",
      acceleration: b.acceleration || "—",
      fuel: b.fuel || "Petrol",
      transmission: b.transmission || "Auto",
      luggage: b.luggage || "2 Large",
      available: b.available !== false,
      featured: false,
      description: b.description || "",
      features: Array.isArray(b.features) ? b.features : [],
      images: Array.isArray(b.images) && b.images.length ? b.images : [b.image].filter(Boolean),
      location: b.location || "—",
      year: Number(b.year) || new Date().getFullYear(),
      color: b.color || "—",
      ownerEmail: b.ownerEmail || null,
      createdAt: new Date(),
    };

    const result = await carsCollection().insertOne(car);
    res.status(201).json({ insertedId: result.insertedId, ...car });
  } catch (error) {
    res.status(500).json({ message: "Failed to create car", error: error.message });
  }
});

// PATCH /api/cars/:id  — update a car
router.patch("/:id", async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;
    delete updates.id;

    const result = await carsCollection().updateOne(
      { id: req.params.id },
      { $set: { ...updates, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ message: "Car not found" });
    res.status(200).json({ message: "Car updated", modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ message: "Failed to update car", error: error.message });
  }
});

// DELETE /api/cars/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await carsCollection().deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ message: "Car not found" });
    res.status(200).json({ message: "Car deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete car", error: error.message });
  }
});

module.exports = router;
