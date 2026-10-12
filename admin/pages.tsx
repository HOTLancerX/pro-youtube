"use client";

import React, { useState, useEffect, useCallback, useTransition, useRef } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";

export interface ProVideoItem {
    title: string;
    videoid: string;
}

export interface BulkProductRow {
    id: string;
    title: string;
    slug: string;
    status: string;
    type: string;
    videos: ProVideoItem[];
    hasVideos: boolean;
    selected: boolean;
    isFetching?: boolean;
    error?: string;
}

interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    totalMissingCount: number;
}

export default function ProYoutubeAdminPage() {
    const [products, setProducts] = useState<BulkProductRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(300);
    const [videoFilter, setVideoFilter] = useState<"missing" | "all" | "completed">("missing");
    const [search, setSearch] = useState("");
    const [englishOnly, setEnglishOnly] = useState(true);
    const [pagination, setPagination] = useState<PaginationInfo>({
        page: 1,
        limit: 300,
        total: 0,
        totalPages: 1,
        totalMissingCount: 0,
    });

    // Batch runner controller state & refs
    const isRunningRef = useRef(false);
    const stopRequestedRef = useRef(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [runnerProgress, setRunnerProgress] = useState<{ current: number; total: number } | null>(null);

    const [isSavingBatch, setIsSavingBatch] = useState(false);
    const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const [activePreviewId, setActivePreviewId] = useState<string | null>(null);

    // Fetch batch of products
    const fetchProducts = useCallback(async (targetPage = page, targetLimit = limit) => {
        setLoading(true);
        setErrorMessage("");
        try {
            const params = new URLSearchParams({
                page: String(targetPage),
                limit: String(targetLimit),
                videoFilter,
                search,
                type: "product",
            });

            const res = await fetch(`/api/pro-youtube/posts?${params.toString()}`);
            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(data.error || "Failed to load products.");
                setProducts([]);
                return;
            }

            const items: BulkProductRow[] = (data.posts || []).map((p: any) => ({
                id: p.id,
                title: p.title || "",
                slug: p.slug || "",
                status: p.status || "draft",
                type: p.type || "product",
                videos: Array.isArray(p.videos) ? p.videos : [],
                hasVideos: Boolean(p.hasVideos),
                selected: true,
                isFetching: false,
            }));

            setProducts(items);
            if (data.pagination) {
                setPagination(data.pagination);
            }
        } catch {
            setErrorMessage("Network error while loading products.");
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }, [page, limit, videoFilter, search]);

    useEffect(() => {
        fetchProducts(page, limit);
    }, [fetchProducts, page, limit]);

    // Selection handlers
    const selectedCount = products.filter((p) => p.selected).length;
    const allSelected = products.length > 0 && selectedCount === products.length;

    const toggleSelectAll = () => {
        const next = !allSelected;
        setProducts((prev) => prev.map((p) => ({ ...p, selected: next })));
    };

    const toggleSelectRow = (id: string) => {
        setProducts((prev) =>
            prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p))
        );
    };

    // Single product video fetch helper — requests only 4 videos (lightning-fast)
    const fetchVideosForTitle = async (title: string): Promise<ProVideoItem[]> => {
        const query = title.trim();
        if (!query) return [];

        const params = new URLSearchParams({
            q: query,
            limit: "4",
            excludeShorts: "true",
            englishOnly: englishOnly ? "true" : "false",
        });

        const res = await fetch(`/api/pro-youtube?${params.toString()}`);
        if (!res.ok) return [];

        const data = await res.json();
        const results = data.results || [];

        // Return up to 4 English videos formatted cleanly
        return results.slice(0, 4).map((r: any) => ({
            title: r.title || "Product Video",
            videoid: r.videoId || "",
        }));
    };

    // Auto-fetch & save for 1 single row
    const handleFetchSingleRow = async (id: string, title: string) => {
        setProducts((prev) =>
            prev.map((p) => (p.id === id ? { ...p, isFetching: true, error: undefined } : p))
        );

        try {
            const fourVideos = await fetchVideosForTitle(title);
            if (fourVideos.length === 0) {
                setProducts((prev) =>
                    prev.map((p) => (p.id === id ? { ...p, isFetching: false, error: "No English videos found." } : p))
                );
                return;
            }

            // Automatically save to database immediately
            await fetch("/api/pro-youtube/bulk-save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ postId: id, videos: fourVideos }]),
            });

            setProducts((prev) =>
                prev.map((p) =>
                    p.id === id
                        ? {
                              ...p,
                              videos: fourVideos,
                              hasVideos: true,
                              isFetching: false,
                              error: undefined,
                          }
                        : p
                )
            );
        } catch {
            setProducts((prev) =>
                prev.map((p) => (p.id === id ? { ...p, isFetching: false, error: "Fetch error" } : p))
            );
        }
    };

    // ─── Play / Stop / Next-10 Controller ────────────────────────────────────
    const handleStop = () => {
        stopRequestedRef.current = true;
        setIsPlaying(false);
    };

    const handlePlayOrStep = async (continuous: boolean = true) => {
        if (isRunningRef.current) return;
        isRunningRef.current = true;
        stopRequestedRef.current = false;
        setIsPlaying(continuous);
        setErrorMessage("");
        setSaveSuccessMessage("");

        // Find selected products that still need videos
        const targetProducts = products.filter(
            (p) => p.selected && (!p.videos || p.videos.length === 0)
        );

        if (targetProducts.length === 0) {
            isRunningRef.current = false;
            setIsPlaying(false);
            alert("No pending products without videos in current selection! Switch to 'Missing Videos Only' or select more items.");
            return;
        }

        const concurrency = 10;
        let totalSaved = 0;

        for (let i = 0; i < targetProducts.length; i += concurrency) {
            if (stopRequestedRef.current) {
                break;
            }

            const chunk = targetProducts.slice(i, i + concurrency);
            const chunkIds = new Set(chunk.map((p) => p.id));

            // Mark this chunk as active fetching
            setProducts((prev) =>
                prev.map((p) => (chunkIds.has(p.id) ? { ...p, isFetching: true, error: undefined } : p))
            );

            setRunnerProgress({ current: Math.min(i + chunk.length, targetProducts.length), total: targetProducts.length });

            // 1. Search 10 in parallel
            const chunkResults = await Promise.all(
                chunk.map(async (prod) => {
                    try {
                        const fourVideos = await fetchVideosForTitle(prod.title);
                        return {
                            id: prod.id,
                            title: prod.title,
                            videos: fourVideos,
                            hasVideos: fourVideos.length > 0,
                            error: fourVideos.length === 0 ? "No English videos found" : undefined,
                        };
                    } catch {
                        return {
                            id: prod.id,
                            title: prod.title,
                            videos: [],
                            hasVideos: false,
                            error: "Search failed",
                        };
                    }
                })
            );

            // 2. Automatically save this batch of 10 to DB
            const itemsToSave = chunkResults.filter((r) => r.videos.length > 0);
            if (itemsToSave.length > 0) {
                try {
                    await fetch("/api/pro-youtube/bulk-save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(
                            itemsToSave.map((it) => ({
                                postId: it.id,
                                videos: it.videos,
                            }))
                        ),
                    });
                    totalSaved += itemsToSave.length;
                } catch (err) {
                    console.error("Auto-save chunk error:", err);
                }
            }

            // 3. Immediately reflect results in the UI table for this chunk of 10
            const resultMap = new Map(chunkResults.map((r) => [r.id, r]));
            setProducts((prev) =>
                prev.map((p) => {
                    const res = resultMap.get(p.id);
                    if (res) {
                        return {
                            ...p,
                            videos: res.videos.length > 0 ? res.videos : p.videos,
                            hasVideos: res.videos.length > 0 || p.hasVideos,
                            isFetching: false,
                            error: res.error,
                        };
                    }
                    return p;
                })
            );

            // If user clicked Next 10 (step mode), stop and hold after processing these 10!
            if (!continuous) {
                break;
            }

            if (stopRequestedRef.current) {
                break;
            }

            await new Promise((r) => setTimeout(r, 200));
        }

        isRunningRef.current = false;
        setIsPlaying(false);
        setRunnerProgress(null);

        if (stopRequestedRef.current) {
            setSaveSuccessMessage("Auto-runner stopped! Progress and videos held and saved in database.");
        } else if (continuous) {
            setSaveSuccessMessage(
                `Completed! Auto-searched and saved videos for ${totalSaved} products in database.`
            );
        } else {
            setSaveSuccessMessage(
                `Processed 10 items & auto-saved ${totalSaved} products in database! Held and ready for next 10.`
            );
        }
        setTimeout(() => setSaveSuccessMessage(""), 5000);
    };

    // ─── Submit All in 1 SINGLE REQUEST & Load Next 100 ────────────────────────
    const handleSubmitBatchAtOnce = async () => {
        const itemsToSave = products
            .filter((p) => p.videos && p.videos.length > 0)
            .map((p) => ({
                postId: p.id,
                videos: p.videos,
            }));

        if (itemsToSave.length === 0) {
            alert("No populated product videos found to save. Click 'Auto-Add 4 Videos to All' first.");
            return;
        }

        setIsSavingBatch(true);
        setSaveSuccessMessage("");
        setErrorMessage("");

        try {
            const res = await fetch("/api/pro-youtube/bulk-save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(itemsToSave),
            });

            const data = await res.json();
            if (!res.ok) {
                setErrorMessage(data.error || "Failed to save product videos.");
                return;
            }

            setSaveSuccessMessage(
                `Successfully saved videos for all ${itemsToSave.length} products in 1 request! Loading next ${limit} entries...`
            );

            // Automatically load next batch of entries
            setTimeout(() => {
                setSaveSuccessMessage("");
                fetchProducts(page, limit);
            }, 1200);
        } catch {
            setErrorMessage("Network error while submitting batch.");
        } finally {
            setIsSavingBatch(false);
        }
    };

    // Remove video from single row
    const handleRemoveVideoFromRow = (productId: string, videoIndex: number) => {
        setProducts((prev) =>
            prev.map((p) => {
                if (p.id !== productId) return p;
                const nextVideos = p.videos.filter((_, idx) => idx !== videoIndex);
                return {
                    ...p,
                    videos: nextVideos,
                    hasVideos: nextVideos.length > 0,
                };
            })
        );
    };

    const handleLimitChange = (newLimit: number) => {
        setLimit(newLimit);
        setPage(1);
        fetchProducts(1, newLimit);
    };

    return (
        <div className="container mx-auto p-4 md:p-6 space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
                <div>
                    <div className="flex items-center gap-2.5 mb-1.5">
                        <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center text-red-600 shadow-2xs">
                            <Icon icon="logos:youtube-icon" className="w-5 h-5" />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900">Pro YouTube Bulk Video Automation</h1>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                            {limit} Products per Batch
                        </span>
                    </div>
                    <p className="text-xs text-gray-500">
                        Automatically attach 4 English YouTube videos to all 100 products with 1 click, review, and submit the batch.
                    </p>
                </div>

                <div className="flex items-center gap-2.5">
                    <button
                        type="button"
                        onClick={() => fetchProducts(page, limit)}
                        disabled={loading || isPlaying || isSavingBatch}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition disabled:opacity-50 cursor-pointer"
                    >
                        <Icon icon="solar:refresh-bold" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Stats Row ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                    <p className="text-xs font-medium text-gray-500 mb-1">Total Products in Filter</p>
                    <p className="text-2xl font-bold text-gray-900">{pagination.total.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                    <p className="text-xs font-medium text-gray-500 mb-1">Products Missing Videos</p>
                    <p className="text-2xl font-bold text-amber-600">{pagination.totalMissingCount.toLocaleString()}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-2xs">
                    <p className="text-xs font-medium text-gray-500 mb-1">Current Batch Loaded</p>
                    <p className="text-2xl font-bold text-red-600">
                        {products.length} <span className="text-xs font-normal text-gray-400">/ {limit} entries</span>
                    </p>
                </div>
            </div>

            {/* ── Controls & Actions ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-100 shadow-2xs sticky top-16 z-10">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Status Filter */}
                    <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
                        <button
                            type="button"
                            onClick={() => { setVideoFilter("missing"); setPage(1); }}
                            className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                                videoFilter === "missing" ? "bg-white text-red-700 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            Missing Videos Only
                        </button>
                        <button
                            type="button"
                            onClick={() => { setVideoFilter("all"); setPage(1); }}
                            className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                                videoFilter === "all" ? "bg-white text-red-700 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            All Products
                        </button>
                        <button
                            type="button"
                            onClick={() => { setVideoFilter("completed"); setPage(1); }}
                            className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                                videoFilter === "completed" ? "bg-white text-red-700 shadow-2xs font-semibold" : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            Completed Only
                        </button>
                    </div>

                    {/* Batch Size Selector */}
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs">
                        <span className="text-gray-500 font-medium whitespace-nowrap">Batch Size:</span>
                        <select
                            value={limit}
                            onChange={(e) => handleLimitChange(Number(e.target.value))}
                            disabled={loading || isPlaying || isSavingBatch}
                            className="bg-white border border-gray-200 rounded-md px-2 py-0.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer"
                        >
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={300}>300 (Default)</option>
                            <option value={500}>500</option>
                        </select>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Icon icon="solar:magnifer-linear" className="absolute left-2.5 top-2.5 text-gray-400 w-3.5 h-3.5" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && fetchProducts(1, limit)}
                            placeholder="Search by title..."
                            className="text-xs border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-red-400 bg-white"
                        />
                    </div>

                    {/* English Filter Toggle */}
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={englishOnly}
                            onChange={(e) => setEnglishOnly(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500 accent-red-600 cursor-pointer"
                        />
                        <span className="font-medium">English Content Only</span>
                    </label>
                </div>

                {/* Primary Action Buttons: Play / Stop / Next 10 / Submit */}
                <div className="flex items-center gap-2">
                    {isPlaying ? (
                        <button
                            type="button"
                            onClick={handleStop}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition shadow-xs animate-pulse cursor-pointer"
                        >
                            <Icon icon="solar:stop-bold" className="w-4 h-4" />
                            <span>Stop ({runnerProgress ? `${runnerProgress.current}/${runnerProgress.total}` : "Running..."})</span>
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => handlePlayOrStep(true)}
                                disabled={selectedCount === 0 || loading || isSavingBatch}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                title="Continuously process 10 by 10 and auto-save each batch"
                            >
                                <span className="w-4 h-4 rounded-full bg-white text-emerald-600 flex items-center justify-center text-[10px]">
                                    <Icon icon="solar:play-bold" className="w-2.5 h-2.5 ml-0.5" />
                                </span>
                                <span>Play Auto-Runner (10 by 10)</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handlePlayOrStep(false)}
                                disabled={selectedCount === 0 || loading || isSavingBatch}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                title="Process only the next 10 items, auto-save to database, and hold"
                            >
                                <Icon icon="solar:forward-bold" className="w-4 h-4 text-red-600" />
                                <span>Next 10 & Hold</span>
                            </button>
                        </>
                    )}

                    <button
                        type="button"
                        onClick={handleSubmitBatchAtOnce}
                        disabled={isSavingBatch || isPlaying || loading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        title="Manually save all modified products to database"
                    >
                        {isSavingBatch ? (
                            <>
                                <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 animate-spin" />
                                <span>Saving…</span>
                            </>
                        ) : (
                            <>
                                <Icon icon="solar:diskette-bold" className="w-4 h-4 text-gray-500" />
                                <span>Save All</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Feedback Messages ── */}
            {saveSuccessMessage && (
                <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
                    <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span>{saveSuccessMessage}</span>
                </div>
            )}
            {errorMessage && (
                <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
                    <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-600 shrink-0" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* ── Table (100 Entries) ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-gray-600">
                        <thead className="bg-gray-50 border-b border-gray-100 text-gray-700 font-semibold uppercase tracking-wider text-[11px]">
                            <tr>
                                <th className="p-3.5 w-10 text-center">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleSelectAll}
                                        className="rounded border-gray-300 text-red-600 focus:ring-red-500 accent-red-600 cursor-pointer"
                                    />
                                </th>
                                <th className="p-3.5 w-72">Product Title</th>
                                <th className="p-3.5">Attached YouTube Videos (Top 4)</th>
                                <th className="p-3.5 w-28 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="py-20 text-center text-gray-400">
                                        <Icon icon="svg-spinners:ring-resize" className="w-8 h-8 mx-auto mb-2 text-red-500 animate-spin" />
                                        <span>Loading {limit} products...</span>
                                    </td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="py-16 text-center text-gray-400">
                                        <Icon icon="solar:box-minimalistic-bold" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                        <span>No products found matching the current filter.</span>
                                    </td>
                                </tr>
                            ) : (
                                products.map((prod, idx) => {
                                    const hasFourVideos = prod.videos && prod.videos.length >= 4;
                                    const hasSomeVideos = prod.videos && prod.videos.length > 0;

                                    return (
                                        <tr
                                            key={prod.id}
                                            className={`hover:bg-gray-50/60 transition ${
                                                prod.selected ? "bg-red-50/15" : ""
                                            }`}
                                        >
                                            {/* Checkbox */}
                                            <td className="p-3.5 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={prod.selected}
                                                    onChange={() => toggleSelectRow(prod.id)}
                                                    className="rounded border-gray-300 text-red-600 focus:ring-red-500 accent-red-600 cursor-pointer"
                                                />
                                            </td>

                                            {/* Title & Slug */}
                                            <td className="p-3.5">
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-semibold text-gray-900 leading-snug">
                                                        {prod.title}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                                                        <span className="font-mono truncate max-w-40">{prod.slug}</span>
                                                        <span>&middot;</span>
                                                        <span className={`px-1.5 py-0.2 rounded font-medium ${
                                                            hasFourVideos
                                                                ? "bg-emerald-50 text-emerald-600"
                                                                : hasSomeVideos
                                                                ? "bg-amber-50 text-amber-600"
                                                                : "bg-gray-100 text-gray-500"
                                                        }`}>
                                                            {prod.videos.length} / 4 Videos
                                                        </span>
                                                    </div>
                                                    {prod.error && (
                                                        <span className="text-[10px] text-red-500 font-medium">
                                                            ⚠ {prod.error}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Videos list */}
                                            <td className="p-3.5">
                                                {prod.isFetching ? (
                                                    <div className="flex items-center gap-2 py-2 text-red-600 text-xs">
                                                        <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 animate-spin" />
                                                        <span>Searching & adding 4 English YouTube videos...</span>
                                                    </div>
                                                ) : prod.videos && prod.videos.length > 0 ? (
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                        {prod.videos.map((vid, vIdx) => (
                                                            <div
                                                                key={vIdx}
                                                                className="flex flex-col bg-gray-50 border border-gray-200/80 rounded-lg p-1.5 text-[11px] relative group/vid"
                                                            >
                                                                {/* Thumbnail */}
                                                                <div
                                                                    onClick={() => vid.videoid && setActivePreviewId(vid.videoid)}
                                                                    className="w-full aspect-video bg-black/10 rounded overflow-hidden relative cursor-pointer mb-1"
                                                                >
                                                                    <img
                                                                        src={`https://img.youtube.com/vi/${vid.videoid}/mqdefault.jpg`}
                                                                        alt={vid.title}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => {
                                                                            (e.target as HTMLElement).style.display = "none";
                                                                        }}
                                                                    />
                                                                    <div className="absolute inset-0 bg-black/25 opacity-0 group-hover/vid:opacity-100 transition-opacity flex items-center justify-center text-white">
                                                                        <Icon icon="solar:play-bold" className="w-4 h-4 drop-shadow" />
                                                                    </div>
                                                                </div>

                                                                {/* Title & ID */}
                                                                <span className="font-medium text-gray-800 line-clamp-1 truncate" title={vid.title}>
                                                                    {vid.title}
                                                                </span>
                                                                <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5">
                                                                    <span className="font-mono text-gray-500">{vid.videoid}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveVideoFromRow(prod.id, vIdx)}
                                                                        className="text-gray-400 hover:text-red-600 p-0.5"
                                                                        title="Remove video"
                                                                    >
                                                                        <Icon icon="solar:trash-bin-trash-linear" className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 py-2 text-gray-400 text-xs italic">
                                                        <Icon icon="logos:youtube-icon" className="w-4 h-4 opacity-40 grayscale" />
                                                        <span>No videos attached yet. Click Auto-Fetch to find 4 videos.</span>
                                                    </div>
                                                )}
                                            </td>

                                            {/* Row Action */}
                                            <td className="p-3.5 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleFetchSingleRow(prod.id, prod.title)}
                                                    disabled={prod.isFetching || isPlaying}
                                                    title="Auto-fetch 4 English videos for this product"
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition disabled:opacity-50 cursor-pointer"
                                                >
                                                    <Icon icon="solar:play-bold" className="w-3 h-3" />
                                                    <span>Fetch 4</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ── Table Footer / Pagination ── */}
                <div className="flex items-center justify-between p-4 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
                    <span>
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total products)
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                const next = Math.max(1, page - 1);
                                setPage(next);
                                fetchProducts(next, limit);
                            }}
                            disabled={page <= 1 || loading}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 cursor-pointer font-medium"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const next = Math.min(pagination.totalPages, page + 1);
                                setPage(next);
                                fetchProducts(next, limit);
                            }}
                            disabled={page >= pagination.totalPages || loading}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 cursor-pointer font-medium"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Preview Modal ── */}
            {activePreviewId && (
                <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
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