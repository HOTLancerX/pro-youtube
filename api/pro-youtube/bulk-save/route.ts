import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import PostInfo from "@/models/post_info";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        await connectDB();

        const body = await req.json();
        const rawItems: any[] = Array.isArray(body)
            ? body
            : Array.isArray(body?.items)
            ? body.items
            : [];

        if (rawItems.length === 0) {
            return NextResponse.json({ error: "No items provided to save." }, { status: 400 });
        }

        const validItems = rawItems
            .map((item) => {
                const postId = String(item.id || item.postId || item._id || "");
                const rawVideos = Array.isArray(item.videos) ? item.videos : [];

                const cleanedVideos = rawVideos
                    .map((v: any) => ({
                        title: String(v.title || "").trim(),
                        videoid: String(v.videoid || v.videoId || "").trim(),
                    }))
                    .filter((v: any) => Boolean(v.videoid));

                return {
                    postId,
                    videos: cleanedVideos,
                };
            })
            .filter((item) => item.postId && mongoose.Types.ObjectId.isValid(item.postId));

        if (validItems.length === 0) {
            return NextResponse.json({ error: "No valid product entries with video data provided." }, { status: 400 });
        }

        const bulkOps = validItems.map((item) => ({
            updateOne: {
                filter: {
                    postId: new mongoose.Types.ObjectId(item.postId),
                    name: "pro_videos",
                },
                update: {
                    $set: {
                        postId: new mongoose.Types.ObjectId(item.postId),
                        name: "pro_videos",
                        value: JSON.stringify(item.videos),
                    },
                },
                upsert: true,
            },
        }));

        const result = await PostInfo.bulkWrite(bulkOps, { ordered: false });

        return NextResponse.json({
            success: true,
            savedCount: validItems.length,
            upserted: result.upsertedCount,
            modified: result.modifiedCount,
        });
    } catch (error: any) {
        console.error("Bulk save error in pro-youtube:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to save product video data." },
            { status: 500 }
        );
    }
}
