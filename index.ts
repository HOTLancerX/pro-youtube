import { addHook, type PluginMeta } from "@/hook";
import ProYoutubeAdminPage from "./admin/pages";
import ProVideo from "./ui/pro-video";

export const PLUGINS: PluginMeta = {
    nx: "pro-youtube",
    name: "pro-youtube",
    version: "1.0.0",
    description: "Pro YouTube integration with keyword search and automated 4-video product attachment.",
    author: "System",
    path: "https://github.com/HOTLancerX/pro-youtube.git",
    icon: "logos:youtube-icon",
    color: "from-red-500 to-red-500",
};

export function register() {
    // ─── Admin Navigation ───────────────────────────────────────────────────
    addHook("admin.nav", [
        {
            key: "pro-youtube",
            label: "Pro YouTube",
            icon: "logos:youtube-icon",
            slug: "pro-youtube",
            parent: "",
            position: 26,
        },
    ], PLUGINS.nx);

    // ─── Admin Pages ────────────────────────────────────────────────────────
    addHook("admin.pages", [
        {
            key: "pro-youtube",
            label: "YouTube Video Search",
            style: "left",
            position: 50,
            active: true,
            path: ProYoutubeAdminPage,
        },
    ], PLUGINS.nx);

    // ─── Product Post Form Field ───────────────────────────────────────────
    addHook("post.form", [
        {
            key: "pro_videos",
            label: "Product Videos",
            type: "product",
            style: "left",
            position: 15,
            component: ProVideo,
        },
    ], PLUGINS.nx);
}
