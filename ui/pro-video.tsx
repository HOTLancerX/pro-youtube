"use client";

import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import type { FieldProps } from "@/hook";

export interface ProVideoItem {
    title: string;
    videoid: string;
}

function parseVideos(raw: string): ProVideoItem[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => ({
                title: String(item.title || "").trim(),
                videoid: String(item.videoid || item.videoId || "").trim(),
            }));
        }
    } catch {
        // invalid JSON
    }
    return [];
}

export default function ProVideo({
    name,
    label = "Product Videos",
    value = "",
    onChange,
    ctx,
}: FieldProps) {
    const parentTitle = (ctx?.title as string) || "";
    const [searchTitle, setSearchTitle] = useState(parentTitle);
    const [videos, setVideos] = useState<ProVideoItem[]>(() => parseVideos(value));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    // Sync searchTitle when parent form title updates (if user hasn't typed custom term)
    useEffect(() => {
        if (parentTitle && !searchTitle) {
            setSearchTitle(parentTitle);
        }
    }, [parentTitle, searchTitle]);

    // Keep internal videos state in sync with external value
    useEffect(() => {
        const parsed = parseVideos(value);
        if (JSON.stringify(parsed) !== JSON.stringify(videos)) {
            setVideos(parsed);
        }
    }, [value]);

    const updateVideos = (newVideos: ProVideoItem[]) => {
        setVideos(newVideos);
        onChange(JSON.stringify(newVideos));
    };

    const handleFetchVideos = async () => {
        const query = (searchTitle || parentTitle).trim();
        if (!query) {
            setError("Please enter a product title to find relevant YouTube videos.");
            return;
        }

        setError(null);
        setLoading(true);

        try {
            const res = await fetch(`/api/pro-youtube?q=${encodeURIComponent(query)}&excludeShorts=true&englishOnly=true`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to search videos.");
            }

            const rawResults = data.results || [];
            if (rawResults.length === 0) {
                setError(`No videos found for "${query}". Try different keywords.`);
                return;
            }

            // Automatically pick top 4 videos with formatted titles and video IDs
            const topFour: ProVideoItem[] = rawResults.slice(0, 4).map((r: any) => ({
                title: r.title || "Product Video",
                videoid: r.videoId || "",
            }));

            updateVideos(topFour);
        } catch (err: any) {
            setError(err.message || "Failed to connect to video search service.");
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveVideo = (index: number) => {
        const updated = videos.filter((_, i) => i !== index);
        updateVideos(updated);
    };

    const handleUpdateVideo = (index: number, field: "title" | "videoid", val: string) => {
        const updated = [...videos];
        updated[index] = { ...updated[index], [field]: val };
        updateVideos(updated);
    };

    const handleAddSingle = () => {
        updateVideos([...videos, { title: "", videoid: "" }]);
    };

    const handleCopyId = async (id: string, index: number) => {
        try {
            await navigator.clipboard.writeText(id);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch {
            // clipboard fallback
        }
    };

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-2xs space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <Icon icon="logos:youtube-icon" className="w-5 h-5" />
                    <div>
                        <h4 className="text-sm font-semibold text-gray-800">{label}</h4>
                        <p className="text-[11px] text-gray-400">
                            Search & automatically attach 4 YouTube videos to this product
                        </p>
                    </div>
                </div>
                {videos.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                        {videos.length} {videos.length === 1 ? "Video" : "Videos"}
                    </span>
                )}
            </div>

            {/* Product Title Bar with Play Button */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 flex items-center justify-between">
                    <span>Product Title / Search Keyword</span>
                    {parentTitle && searchTitle !== parentTitle && (
                        <button
                            type="button"
                            onClick={() => setSearchTitle(parentTitle)}
                            className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                        >
                            <Icon icon="solar:restart-linear" className="w-3 h-3" />
                            Sync with post title
                        </button>
                    )}
                </label>

                <div className="relative flex items-center">
                    <input
                        type="text"
                        value={searchTitle}
                        onChange={(e) => setSearchTitle(e.target.value)}
                        placeholder={parentTitle || "Enter product title to search YouTube..."}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleFetchVideos();
                            }
                        }}
                        className="w-full pr-32 pl-3.5 py-2.5 bg-gray-50/70 hover:bg-gray-50 focus:bg-white text-sm text-gray-900 border border-gray-200 rounded-lg outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    />

                    {/* Prominent Play Button placed on the title input */}
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                            type="button"
                            onClick={handleFetchVideos}
                            disabled={loading}
                            title="Click to automatically fetch 4 YouTube videos for this title"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-md text-xs font-semibold shadow-xs transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed group cursor-pointer"
                        >
                            {loading ? (
                                <>
                                    <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 animate-spin" />
                                    <span>Adding…</span>
                                </>
                            ) : (
                                <>
                                    <span className="w-4 h-4 rounded-full bg-white text-red-600 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-110 transition-transform">
                                        <Icon icon="solar:play-bold" className="w-2.5 h-2.5 ml-0.5" />
                                    </span>
                                    <span>Auto 4 Videos</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50/90 border border-red-200 text-red-700 rounded-lg text-xs">
                    <Icon icon="solar:danger-triangle-linear" className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{error}</span>
                    <button
                        type="button"
                        onClick={() => setError(null)}
                        className="text-red-400 hover:text-red-600"
                    >
                        <Icon icon="solar:close-circle-linear" className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {/* Videos List / Grid */}
            {videos.length > 0 ? (
                <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {videos.map((vid, idx) => {
                            const isCopied = copiedIndex === idx;
                            const hasId = Boolean(vid.videoid && vid.videoid.trim());

                            return (
                                <div
                                    key={idx}
                                    className="relative flex flex-col p-2.5 rounded-lg border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-gray-300 transition-all shadow-2xs group"
                                >
                                    {/* Video index badge & action buttons */}
                                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                                        <span className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
                                            <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-[10px]">
                                                {idx + 1}
                                            </span>
                                            Video {idx + 1}
                                        </span>

                                        <div className="flex items-center gap-1">
                                            {hasId && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyId(vid.videoid, idx)}
                                                        className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                                                        title="Copy Video ID"
                                                    >
                                                        {isCopied ? (
                                                            <Icon icon="solar:check-read-linear" className="w-3.5 h-3.5 text-emerald-600" />
                                                        ) : (
                                                            <Icon icon="solar:copy-linear" className="w-3.5 h-3.5" />
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setActivePreviewId(vid.videoid)}
                                                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
                                                        title="Watch / Preview video"
                                                    >
                                                        <Icon icon="solar:play-circle-bold" className="w-3.5 h-3.5" />
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveVideo(idx)}
                                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                                title="Remove Video"
                                            >
                                                <Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Video content: Thumbnail + Title & ID inputs */}
                                    <div className="flex gap-2.5">
                                        {/* Thumbnail preview */}
                                        <div
                                            className="w-24 h-16 rounded overflow-hidden bg-black/10 shrink-0 relative group/thumb cursor-pointer"
                                            onClick={() => hasId && setActivePreviewId(vid.videoid)}
                                        >
                                            {hasId ? (
                                                <>
                                                    <img
                                                        src={`https://img.youtube.com/vi/${vid.videoid}/mqdefault.jpg`}
                                                        alt={vid.title}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            (e.target as HTMLElement).style.display = "none";
                                                        }}
                                                    />
                                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                                                        <Icon icon="solar:play-bold" className="w-5 h-5 text-white drop-shadow" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                    <Icon icon="solar:videocamera-record-bold" className="w-5 h-5" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Inputs */}
                                        <div className="flex-1 min-w-0 space-y-1.5">
                                            <input
                                                type="text"
                                                value={vid.title}
                                                onChange={(e) => handleUpdateVideo(idx, "title", e.target.value)}
                                                placeholder="Video title"
                                                className="w-full px-2 py-1 text-xs font-medium text-gray-800 bg-white border border-gray-200 rounded focus:border-red-500 outline-none truncate"
                                            />
                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] font-mono font-semibold text-gray-400">ID:</span>
                                                <input
                                                    type="text"
                                                    value={vid.videoid}
                                                    onChange={(e) => handleUpdateVideo(idx, "videoid", e.target.value)}
                                                    placeholder="e.g. dQw4w9WgXcQ"
                                                    className="w-full px-2 py-0.5 text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded focus:border-red-500 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Bottom action row */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                        <button
                            type="button"
                            onClick={handleAddSingle}
                            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 font-medium py-1 px-2 rounded hover:bg-gray-100 transition"
                        >
                            <Icon icon="solar:add-circle-bold" className="w-4 h-4 text-gray-400" />
                            Add another video
                        </button>

                        <button
                            type="button"
                            onClick={() => updateVideos([])}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-medium py-1 px-2 rounded hover:bg-red-50 transition"
                        >
                            <Icon icon="solar:trash-bin-trash-linear" className="w-3.5 h-3.5" />
                            Clear all
                        </button>
                    </div>
                </div>
            ) : (
                <div className="text-center py-6 px-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/60">
                    <Icon icon="logos:youtube-icon" className="w-8 h-8 mx-auto mb-2 opacity-80" />
                    <p className="text-xs font-medium text-gray-700">No product videos added yet</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                        Click the red <strong className="text-gray-600 font-semibold">Auto 4 Videos</strong> play button above to automatically search and attach 4 videos from YouTube.
                    </p>
                </div>
            )}

            {/* Video Preview Modal */}
            {activePreviewId && (
                <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl bg-black rounded-xl overflow-hidden shadow-2xl border border-neutral-800">
                        <div className="flex items-center justify-between p-3 bg-neutral-900 text-white">
                            <span className="text-xs font-mono text-neutral-300">
                                YouTube ID: {activePreviewId}
                            </span>
                            <button
                                type="button"
                                onClick={() => setActivePreviewId(null)}
                                className="p-1 text-neutral-400 hover:text-white rounded"
                            >
                                <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="aspect-video w-full bg-black">
                            <iframe
                                src={`https://www.youtube.com/embed/${activePreviewId}?autoplay=1`}
                                title="YouTube Preview"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="w-full h-full border-0"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
