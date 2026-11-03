const express = require("express");
const { ObjectId } = require("mongodb");
const { client } = require("../db");

const router = express.Router();

const db = () => client.db("drive-easy");
const reviewsCollection = () => db().collection("reviews");
const carsCollection = () => db().collection("cars");

// Recompute a car's average rating + review count from its reviews.
async function recomputeCarRating(carId) {
  const carReviews = await reviewsCollection().find({ carId }).toArray();
  if (carReviews.length === 0) {
    await carsCollection().updateOne({ id: carId }, { $set: { rating: 0, reviewCount: 0 } });
    return;
  }
  const avg = carReviews.reduce((s, r) => s + r.rating, 0) / carReviews.length;
  await carsCollection().updateOne(
    { id: carId },
    { $set: { rating: Math.round(avg * 10) / 10, reviewCount: carReviews.length } }
  );
}

// GET /api/reviews
//   ?carId=<id>   reviews for one car (public, car detail page)
//   ?user=<email> reviews written by a customer (their dashboard)
//   ?owner=<email> reviews for an agency's cars (agency dashboard)
//   (none)        all reviews (admin)
router.get("/", async (req, res) => {
  try {
    const { carId, user, owner } = req.query;
    const filter = {};
    if (carId) filter.carId = carId;
    if (user) filter.userEmail = user;
    if (owner) {
      const ownerCars = await carsCollection().find({ ownerEmail: owner }).project({ id: 1 }).toArray();
      filter.carId = { $in: ownerCars.map((c) => c.id) };
    }

    const reviews = await reviewsCollection().find(filter).sort({ createdAt: -1 }).toArray();
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reviews", error: error.message });
  }
});

// POST /api/reviews  — create a review (one per user per car) and refresh the car rating
router.post("/", async (req, res) => {
  try {
    const { carId, userEmail, name, avatar, rating, title, body } = req.body;

    if (!carId || !name || !rating || !title || !body) {
      return res.status(400).json({ message: "carId, name, rating, title and body are required" });
    }

    const numericRating = Number(rating);
    if (numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    // One review per user per car — update instead of duplicating.
    if (userEmail) {
      const existing = await reviewsCollection().findOne({ carId, userEmail });
      if (existing) {
        return res.status(409).json({ message: "You have already reviewed this car" });
      }
    }

    const review = {
      carId,
      userEmail: userEmail || null,
      name,
      avatar: avatar || `https://i.pravatar.cc/150?u=${encodeURIComponent(name)}`,
      rating: numericRating,
      title,
      body,
      date: new Date().toISOString().slice(0, 10),
      verified: true,
      createdAt: new Date(),
    };

    const result = await reviewsCollection().insertOne(review);
    await recomputeCarRating(carId);

    res.status(201).json({ insertedId: result.insertedId, ...review });
  } catch (error) {
    res.status(500).json({ message: "Failed to create review", error: error.message });
  }
});

// PATCH /api/reviews/:id  — edit rating/title/body (owner of the review)
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid review ID" });

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.body !== undefined) updates.body = req.body.body;
    if (req.body.rating !== undefined) {
      const r = Number(req.body.rating);
      if (r < 1 || r > 5) return res.status(400).json({ message: "Rating must be between 1 and 5" });
      updates.rating = r;
    }

    const review = await reviewsCollection().findOne({ _id: new ObjectId(id) });
    if (!review) return res.status(404).json({ message: "Review not found" });

    await reviewsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    await recomputeCarRating(review.carId);

    res.status(200).json({ message: "Review updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update review", error: error.message });
  }
});

// DELETE /api/reviews/:id  — remove a review (owner, or admin moderation)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid review ID" });

    const review = await reviewsCollection().findOne({ _id: new ObjectId(id) });
    if (!review) return res.status(404).json({ message: "Review not found" });

    await reviewsCollection().deleteOne({ _id: new ObjectId(id) });
    await recomputeCarRating(review.carId);

    res.status(200).json({ message: "Review deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete review", error: error.message });
  }
});

module.exports = router;
