import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

// Deployed to GitHub Pages as a project site: https://riz007.github.io/larb/
const base = "/larb/";

export default withMermaid(
  defineConfig({
    base,
    title: "Larb",
    description:
      "Open-source, model-agnostic, security-first autonomous coding agent — architecture, comparison, and roadmap.",
    lastUpdated: true,
    cleanUrls: true,
    ignoreDeadLinks: true,

    head: [
      ["meta", { name: "theme-color", content: "#10b981" }],
      ["meta", { property: "og:type", content: "website" }],
      [
        "meta",
        { property: "og:title", content: "Larb — security-first coding agent" },
      ],
    ],

    themeConfig: {
      socialLinks: [{ icon: "github", link: "https://github.com/riz007/larb" }],
      search: { provider: "local" },
    },

    locales: {
      root: {
        label: "English",
        lang: "en",
        themeConfig: {
          nav: [
            { text: "Home", link: "/" },
            { text: "Architecture", link: "/architecture" },
            { text: "Comparison", link: "/comparison" },
            { text: "Roadmap", link: "/roadmap" },
            { text: "Security", link: "/security" },
          ],
          sidebar: [
            {
              text: "Larb",
              items: [
                { text: "Overview", link: "/" },
                { text: "Architecture", link: "/architecture" },
                { text: "Comparison with other agents", link: "/comparison" },
                { text: "Roadmap", link: "/roadmap" },
                { text: "Security model", link: "/security" },
              ],
            },
          ],
          editLink: {
            pattern: "https://github.com/riz007/larb/edit/main/website/:path",
            text: "Edit this page on GitHub",
          },
          docFooter: { prev: "Previous", next: "Next" },
          outline: { label: "On this page", level: [2, 3] },
        },
      },

      th: {
        label: "ไทย",
        lang: "th",
        link: "/th/",
        themeConfig: {
          nav: [
            { text: "หน้าแรก", link: "/th/" },
            { text: "สถาปัตยกรรม", link: "/th/architecture" },
            { text: "เปรียบเทียบ", link: "/th/comparison" },
            { text: "โรดแมป", link: "/th/roadmap" },
            { text: "ความปลอดภัย", link: "/th/security" },
          ],
          sidebar: [
            {
              text: "Larb",
              items: [
                { text: "ภาพรวม", link: "/th/" },
                { text: "สถาปัตยกรรม", link: "/th/architecture" },
                { text: "เปรียบเทียบกับเอเจนต์อื่น", link: "/th/comparison" },
                { text: "โรดแมป", link: "/th/roadmap" },
                { text: "แบบจำลองความปลอดภัย", link: "/th/security" },
              ],
            },
          ],
          editLink: {
            pattern: "https://github.com/riz007/larb/edit/main/website/:path",
            text: "แก้ไขหน้านี้บน GitHub",
          },
          docFooter: { prev: "ก่อนหน้า", next: "ถัดไป" },
          outline: { label: "ในหน้านี้", level: [2, 3] },
        },
      },
    },

    // Larger base font so dense diagrams (e.g. the roadmap timeline) stay legible;
    // CSS lets wide diagrams scroll horizontally instead of shrinking (theme/custom.css).
    mermaid: {
      theme: "default",
      themeVariables: { fontSize: "16px" },
    },
  }),
);
