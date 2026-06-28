# สถาปัตยกรรม

Larb เป็นมอนอรีโพ TypeScript (pnpm workspaces) ทุกองค์ประกอบเป็นโมดูลที่ระบุสเปกได้
อยู่เบื้องหลังอินเทอร์เฟซที่สะอาด ดังนั้นจึงไม่มีโมเดล ผู้ให้บริการ หรือเทคโนโลยี
แซนด์บ็อกซ์ใดได้รับสิทธิพิเศษในโค้ดเบส

## ภาพรวมระดับสูง

ชั้นอินเทอร์เฟซสื่อสารกับ **ออร์เคสเตรเตอร์** ที่ขับเคลื่อนลูป วางแผน → ลงมือ →
สังเกต → ตรวจสอบ ออร์เคสเตรเตอร์ใช้ระบบย่อยสี่ส่วน และถูกห่อด้วย **ตัวควบคุม
ข้ามระบบ** ที่บังคับใช้ความเชื่อถือ สิทธิ์ ค่าใช้จ่าย และการตรวจสอบในทุกการกระทำ

```mermaid
flowchart TD
    U([User]) --> IF["Interface layer<br/>CLI · TUI · editor bridge"]
    IF --> ORCH["Agent Orchestrator<br/>plan → act → observe → verify"]

    ORCH --> MP["Model Provider<br/>Abstraction"]
    ORCH --> TL["Tool / Capability<br/>Layer + exec sandbox"]
    ORCH --> CE["Context Engine<br/>repo map · memory · AGENTS.md · compaction"]
    ORCH --> SK["Skill / Plugin<br/>Registry (signed)"]
    ORCH --> MC["MCP servers<br/>external tools (gated)"]

    subgraph GOV["Cross-cutting governors"]
      direction LR
      TR["Trust engine"]
      PE["Permission engine"]
      CG["Cost / spend governor"]
      AL["Audit log"]
    end

    MP -.enforced by.-> GOV
    TL -.enforced by.-> GOV
    CE -.enforced by.-> GOV
    SK -.enforced by.-> GOV
    MC -.enforced by.-> GOV

    MP --> PR{{"Anthropic · OpenAI ·<br/>Ollama · 8 more"}}
    TL --> SB[["Sandbox backend<br/>container / spawn"]]
```

## ลูปของเอเจนต์

งาน `run` ยังไม่ถือว่า "เสร็จ" จนกว่าคำสั่งตรวจสอบของโปรเจกต์จะผ่าน (หรือใช้
จำนวนรอบจนหมดงบ) ลูปจะบันทึกสแน็ปช็อตถาวรทุกรอบ ทำให้รันที่ถูกขัดจังหวะ
กลับมาทำต่อจากจุดเดิมได้พอดี

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant M as Model provider
    participant P as Permission engine
    participant S as Sandbox
    participant V as Verify loop

    O->>M: stream(system + messages + tools)
    M-->>O: text deltas + tool calls
    loop each tool call
        O->>P: require(capability, path/host)
        P-->>O: allow / deny (prompt if needed)
        O->>S: execute (cwd-scoped, secrets stripped)
        S-->>O: result (guarded vs injection)
    end
    O->>M: feed tool results back
    Note over O,M: repeat until the model stops calling tools
    O->>V: run lint / build / tests
    V-->>O: pass ✓ / fail ✗ (+ report)
    alt verification failed
        O->>M: "fix the issues, then continue"
    else passed
        O-->>O: done — record final snapshot
    end
```

**โหมดหลายเอเจนต์** โมเดล *ออร์เคสเตรเตอร์* ที่แข็งแรงสามารถมอบหมายงานย่อยที่
จำกัดขอบเขตให้โมเดล *เวิร์กเกอร์* ที่ถูกกว่า (รูปแบบ Pro/Flash ของ DeepSeek ที่
นำมาใช้ทั่วไปข้ามผู้ให้บริการ) เวิร์กเกอร์ใช้เอนจินสิทธิ์และตัวควบคุมค่าใช้จ่าย
ร่วมกัน และไม่มีเครื่องมือมอบหมายของตัวเอง จึงจำกัดการเรียกซ้อนได้

## กระแสความเชื่อถือและสิทธิ์

นี่คือพฤติกรรมด้านความปลอดภัยที่เป็นจุดเด่น เมื่อเปิดไดเรกทอรี Larb อ่านคอนฟิก
ที่เป็นโค้ด **ศูนย์** ไฟล์ และเรียกเครือข่าย **ศูนย์** ครั้ง จนกว่าคุณจะตัดสินใจ
หลังจากนั้นทุกการใช้ความสามารถจะถูกตรวจ เป็นชั้น และบันทึกไว้

```mermaid
flowchart TD
    A([Open a directory]) --> B{Trusted?}
    B -- no --> C["Prompt: read-only / full / deny<br/>(no config read, no network yet)"]
    C -->|deny| Z([Stop — nothing happened])
    C -->|trust| D[Build governed session]
    B -- yes --> D
    D --> E{{Capability request}}
    E --> F{deny policy?}
    F -- match --> X([Denied])
    F -- no --> G{allow policy / grant?}
    G -- yes --> Y([Allowed · logged])
    G -- no --> H[Ask: once / session / always / deny]
    H --> Y
    H --> X
```

คอนฟิกระดับรีโพสามารถ *เสนอ* โมเดล คำสั่งตรวจสอบ และลดเพดานค่าใช้จ่ายได้ — แต่
**ไม่มีวัน** ตั้ง base URL ของ API เลือกตัวแปรสภาพแวดล้อมของคีย์ เพิ่มกฎอนุญาต
เพิ่มเพดาน ลดความเข้มของแซนด์บ็อกซ์ หรือสั่งรันโค้ดได้

## การนามธรรมผู้ให้บริการโมเดล

อินเทอร์เฟซบาง ๆ — `generate`, `stream`, `countTokens`, `estimateCost` — พร้อม
อะแดปเตอร์สำหรับ Anthropic Messages API, OpenAI Chat Completions และ Ollama ในเครื่อง
ผู้ให้บริการส่วนใหญ่เปิด API ที่เข้ากันได้กับ OpenAI จึงใช้อะแดปเตอร์ที่ตรวจสอบแล้ว
ตัวเดียวร่วมกัน การเพิ่มผู้ให้บริการคือการเพิ่มแถวในตารางพรีเซ็ต ไม่ใช่เขียนโค้ดใหม่

```mermaid
flowchart LR
    CFG["config.toml<br/>kind = …"] --> R[ProviderRouter]
    R --> SBK[[Secret broker<br/>reads key from env, redacts everywhere]]
    R -->|transport| AN[Anthropic Messages]
    R -->|transport| OA[OpenAI Chat Completions]
    R -->|transport| OL[Ollama local]
    OA --- DS[DeepSeek]
    OA --- GE[Gemini]
    OA --- GR[Groq]
    OA --- MI[Mistral]
    OA --- XA[xAI]
    OA --- OR[OpenRouter]
    OA --- TO[Together]
    OA --- PE[Perplexity]
```

การกำหนดเส้นทางเป็นนโยบายที่ประกาศได้ ไม่ใช่ฮาร์ดโค้ด: **ออร์เคสเตรชัน → โมเดลแรง**,
**ซับเอเจนต์ / การบีบอัด → โมเดลถูกและเร็ว**, **ออฟไลน์ → โมเดลในเครื่อง** คีย์ API
ถูกอ่านครั้งเดียวโดยตัวรับฝากความลับ และส่งให้เฉพาะอะแดปเตอร์ — ลูปเอเจนต์และ
เครื่องมือไม่เคยเห็นคีย์

## แซนด์บ็อกซ์การรันคำสั่ง

การรันคำสั่งทำผ่าน **แบ็กเอนด์แบบเสียบเปลี่ยนได้** เบื้องหลังอินเทอร์เฟซเดียว

```mermaid
flowchart TD
    RUN([Command to run]) --> SEL{backend policy}
    SEL -->|auto + runtime found| C[ContainerBackend]
    SEL -->|auto, no runtime| S[SpawnBackend]
    SEL -->|container, none| ERR([Error: won't silently downgrade])
    C --> CI["rootless docker/podman<br/>project-only mount · no host secrets<br/>--network none by default"]
    C -->|network = allowlist| PX[Host egress proxy<br/>per-host default-deny]
    S --> SI["host subprocess<br/>cwd-scoped · secrets stripped<br/>⚠ reduced isolation"]
```

ระดับการแยกสภาพแวดล้อมที่ใช้งานอยู่จะถูกแสดงตอนเริ่มทุกการรัน เพื่อให้การตัดสินใจ
ไว้วางใจมีข้อมูลครบ แบ็กเอนด์คอนเทนเนอร์คือพรีมิทีฟการแยกระดับเดียวกับ Codex และ
สามารถเสียบแบ็กเอนด์ไมโครวีเอ็มเข้าที่รอยต่อเดิมได้ในภายหลัง

## เอนจินบริบท

- **แผนผังรีโพ** — ดัชนีโครงสร้างแบบเพิ่มทีละส่วนสำหรับการให้เหตุผลข้ามไฟล์
- **หน่วยความจำ** — มาร์กดาวน์บนดิสก์ที่ตรวจสอบได้ ขอบเขตต่อโปรเจกต์
- **คำแนะนำของโปรเจกต์ (`AGENTS.md`)** — ไฟล์ `AGENTS.md` และ `.larb/AGENTS.md` ถูก
  โหลดเข้าเป็นบริบทเชิงแนะนำใน system prompt (จำกัดขนาด) ใช้ชี้แนะแนวทางการทำงานของ
  เอเจนต์ได้ แต่ไม่สามารถลบล้างหลักความปลอดภัยหรือเอนจินสิทธิ์ได้
- **การบีบอัด** — สรุปเชิงรุกด้วยโมเดลเวิร์กเกอร์ราคาถูก เพื่อให้เซสชันยาว ๆ ยัง
  ประหยัดและไม่ล้นหน้าต่างบริบท
- **ตัวป้องกันการแทรกคำสั่ง** — เอาต์พุตจากเครื่องมือ/รีโพที่ไม่น่าเชื่อถือจะถูก
  คัดกรองหาคำสั่งที่ถูกแทรกก่อนกลับเข้าสู่บริบทของโมเดล

## รีจิสทรีสกิลและปลั๊กอิน

```mermaid
flowchart LR
    SRC[["dir · https tarball · git URL"]] --> INST[Install<br/>copy + validate manifest]
    INST --> TIER{Signature?}
    TIER -->|maintainer key| FP[first-party]
    TIER -->|trusted key| VF[verified]
    TIER -->|unsigned/tampered| CM["community<br/>tightest sandbox + consent"]
    FP & VF & CM --> RUN["Run in isolated child process<br/>broker enforces the manifest"]
```

ทุกสกิลมาพร้อม **แมนิเฟสต์** ที่ประกาศความสามารถที่ต้องใช้อย่างชัดเจน (เส้นทาง fs,
โฮสต์เครือข่าย, การรันคำสั่ง, ความลับ) ตัวรับฝากบังคับใช้แมนิเฟสต์นั้นทั้งกับสิ่งที่
ประกาศและกับเอนจินสิทธิ์ — **ติดตั้ง ≠ เชื่อถือ**

## MCP (เครื่องมือภายนอก)

Larb รองรับ **Model Context Protocol** คุณจึงเชื่อมต่อเซิร์ฟเวอร์เครื่องมือภายนอก
(ระบบไฟล์, GitHub, ฐานข้อมูล หรือของคุณเอง) เข้ามาได้ และเอเจนต์จะใช้งานมันเหมือน
เครื่องมือในตัว

```mermaid
flowchart LR
    CFG["~/.larb/config.toml<br/>[[mcp]] (trusted-global only)"] --> MGR[MCP manager]
    MGR -->|stdio JSON-RPC| SRV[["MCP server<br/>(spawned in a run)"]]
    SRV --> TOOLS["tools/list → tools/call"]
    TOOLS --> GATE{Permission engine<br/>mcp capability}
    GATE -->|allow · logged| ORCH2[Orchestrator loop]
    GATE -->|deny| X([Denied])
```

- เครื่องมือจากระยะไกลแต่ละตัวปรากฏเป็น `mcp__<server>__<tool>` และ **ผ่านการ
  ตรวจสิทธิ์** ด้วยความสามารถ `mcp` ที่จำกัดขอบเขตตามเซิร์ฟเวอร์ ทุกการเรียกถูก
  บันทึก และเอาต์พุตผ่านตัวป้องกันการแทรกคำสั่ง
- คอนฟิก `[[mcp]]` อยู่ใน **คอนฟิกระดับโกลบอลที่เชื่อถือเท่านั้น** — เพราะเซิร์ฟเวอร์
  stdio สั่งรันคำสั่งได้ รีโพที่ไม่น่าเชื่อถือจึงนิยามมันไม่ได้ เซิร์ฟเวอร์จะเชื่อมต่อ
  **เฉพาะระหว่างการรัน** (หลังตัดสินใจเชื่อถือ) และถูกปิดเมื่อจบ
- ดูเซิร์ฟเวอร์ที่ตั้งค่าไว้ด้วย `larb mcp` หรือเชื่อมต่อเพื่อแสดงเครื่องมือด้วย
  `larb mcp probe`

## โครงสร้างที่เก็บโค้ด

```
packages/
  governors/   trust · permission · cost · audit · secret broker
  providers/   model adapters · routing · conformance suite
  sandbox/     pluggable execution isolation · egress proxy
  context/     repo map · markdown memory · AGENTS.md · compaction
  core/        orchestrator loop · tools · run state · bench · worktrees
  skills/      skill + plugin runtime · manifest · signing · broker
  mcp/         Model Context Protocol client · stdio transport · tool broker
  cli/         CLI · Ink TUI · editor bridge
skills-sdk/    TypeScript SDK สำหรับสกิลของชุมชน
```

อ่านต่อที่ **[เปรียบเทียบ](/th/comparison)** หรือ **[แบบจำลองความปลอดภัย](/th/security)**
