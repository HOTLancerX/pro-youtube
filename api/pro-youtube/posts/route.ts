import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Post from "@/models/post";
import PostInfo from "@/models/post_info";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    try {
        await connectDB();

        const { searchParams } = new URL(req.url);
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "300", 10)));
        const postType = searchParams.get("type") || "product";
        const videoFilter = searchParams.get("videoFilter") || "missing"; // "missing" | "all" | "completed"
        const search = searchParams.get("search")?.trim() || "";

        // Base post query
        const baseQuery: Record<string, any> = {
            status: { $ne: "trash" },
        };

        if (postType && postType !== "all") {
            baseQuery.type = postType;
        }

        if (search) {
            baseQuery.title = { $regex: search, $options: "i" };
        }

        // Find IDs of products with existing, non-empty pro_videos
        const existingVideoDocs = await PostInfo.find({
            name: "pro_videos",
            value: { $exists: true, $ne: "", $nin: ["", "[]", "null"] },
        }).select("postId").lean();

        const existingPostIds = existingVideoDocs.map((d: any) => d.postId);

        // Apply filter logic
        const query: Record<string, any> = { ...baseQuery };
        if (videoFilter === "missing") {
            query._id = { $nin: existingPostIds };
        } else if (videoFilter === "completed") {
            query._id = { $in: existingPostIds };
        }

        const total = await Post.countDocuments(query);
        const totalMissingCount = await Post.countDocuments({
            ...baseQuery,
            _id: { $nin: existingPostIds },
        });

        const skip = (page - 1) * limit;
        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select("_id title slug type status createdAt")
            .lean();

        // Fetch video data for the current batch of posts
        const postIds = posts.map((p: any) => p._id);
        const infos = await PostInfo.find({
            postId: { $in: postIds },
            name: "pro_videos",
        }).lean();

        const infoMap = new Map<string, any[]>();
        infos.forEach((inf: any) => {
            try {
                const parsed = JSON.parse(inf.value);
                if (Array.isArray(parsed)) {
                    infoMap.set(String(inf.postId), parsed);
                }
            } catch {
                // ignore invalid json
            }
        });

        const items = posts.map((p: any) => {
            const vids = infoMap.get(String(p._id)) || [];
            return {
                id: p._id,
                title: p.title || "",
                slug: p.slug || "",
                type: p.type || "product",
                status: p.status || "draft",
                videos: vids.map((v: any) => ({
                    title: String(v.title || "").trim(),
                    videoid: String(v.videoid || v.videoId || "").trim(),
                })),
                hasVideos: vids.length > 0,
            };
        });

        return NextResponse.json({
            posts: items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
                totalMissingCount,
            },
        });
    } catch (error: any) {
        console.error("Error fetching products for pro-youtube:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to load products" },
            { status: 500 }
        );
    }
}
