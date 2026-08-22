# AI CRM CSV Importer (GrowEasy Assignment Submission)

An intelligent, production-ready full-stack application that leverages Gemini AI to parse, sanitize, and map arbitrary CRM lead CSV files into a standard CRM schema. 

This tool does not rely on static column indices or pre-defined names. Instead, it utilizes Generative AI to understand the context of the CSV structure and automatically format contacts according to the target specifications.

---

DEMO: Open [http://localhost:3000](http://localhost:3000) to view the application.
Open [http://localhost:3000](https://ai-csv-importer-dm7sv5w81-chatrapatichavan8-7087s-projects.vercel.app/



## 🚀 Key Features

*   **Intelligent AI Schema Mapping**: Automatically detects and maps name, email, phone number, company, location (city, state, country), status, and notes regardless of column naming conventions.
*   **Dual CSV Parsing Pipeline**: Instant, high-performance local parsing on the frontend for raw previews before committing resources to AI processing.
*   **Resilient Batch Pipeline**: Batches records in sets of 20 and runs sequential AI requests with automatic exponential-backoff retries.
*   **Production Error Resilience**: If a batch fails permanently, the import skips that batch to prevent aborting the entire upload, recording skipped reasons for display.
*   **Interactive Dashboard**: SaaS dashboard that visualizes imported stats, status distributions, and provides tabs for "Imported" and "Skipped" records with detailed reasons.
*   **Custom Exporters**: Direct single-click downloading of processed CRM leads in perfectly escaped standard CRM CSV format and JSON.
*   **Dark Mode Toggle**: Sleek visual mode switching that respects browser defaults and persists user preferences.

---

## 🛠️ Folder Structure & Architecture

```text
/
├── server.ts               # Custom Express server with Vite Dev Middleware & Prod Hosting
├── server/
│   └── geminiService.ts    # Service layer for Google GenAI SDK and CRM prompts
├── src/
│   ├── main.tsx            # React application mounting entry point
│   ├── App.tsx             # Main dashboard container with core state and handlers
│   ├── index.css           # Global Tailwind CSS styles and font imports
│   ├── types.ts            # Shared TypeScript type signatures and CRM schema
│   └── components/
│       ├── Dropzone.tsx    # Animated file picker & drag-drop upload area
│       ├── ThemeToggle.tsx # Theme controller (Sun/Moon animations)
│       ├── CSVPreviewTable.tsx # Searchable, paginated CSV preview table
│       ├── ProgressIndicator.tsx # Visual progress tracker and active pipeline metrics
│       └── ImportResultsDashboard.tsx # SaaS dashboard, charts, table tabs, and exporters
├── metadata.json           # Application configurations and server capabilities
├── package.json            # NPM dependencies and full-stack dev/build/start scripts
└── tsconfig.json           # TypeScript compilation configuration
```

---

## ⚙️ Environment Variables

Copy the `.env.example` file and create a `.env` in the root folder:

```env

Open [http://localhost:3000](https://ai-csv-importer-dm7sv5w81-chatrapatichavan8-7087s-projects.vercel.app/
) to view the application.

# Base URL where the app is hosted (injected automatically in production)
APP_URL="http://localhost:3000"
```

---

## 💻 Setup and Local Development

### Prerequisites
*   Node.js v18+ 
*   NPM v9+

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
Starts the custom Express server and mounts Vite's hot-reload middleware:
```bash
npm run dev
```
) to view the application.


### 3. Build for Production
Compiles the static client asset bundle via Vite, and bundles the Node server entrypoint into a single self-contained `.cjs` module via `esbuild`:
```bash
npm run build
```

### 4. Start Production Server
```bash
npm run start
```

---

## 🧠 AI Prompt Engineering Strategy

Our AI mapping layer is powered by the TypeScript SDK on the server using **Gemini 3.5 Flash** with **Structured JSON Schema Constraints**.

### Design Principles:
1.  **Structured Output Schema**: Instead of raw text completions or code fences, we declare a nested schema parameter in the Gemini configuration `responseSchema` (`Type.ARRAY` of `Type.OBJECT`). This strictly guarantees that the model response is a perfectly formatted, parseable JSON block, eliminating runtime JSON parsing errors.
2.  **No Hallucinations**: Prompt guidelines instruct Gemini to leave fields blank rather than inventing data.
3.  **Strict Skipped Tracking**: Instead of just filtering out columns, Gemini maps rows into a payload specifying `skipped: true` with a detailed `skip_reason` (e.g. "Missing both contact email and phone"). The frontend parses this to display Skipped row records.
4.  **Data Coalescing**: Gemini combines separate first and last name columns into a single `name` attribute, and aggregates excess email addresses or phone lines into the `crm_note` block automatically.


## 🛠️ Troubleshooting

*   **API Key Errors**: If the `GEMINI_API_KEY` is not present, the server falls back gracefully to an intelligent header regex matcher to allow users to preview the landing page, download sample CSVs, and inspect tables. Ensure your secret is set inside your cloud secrets dashboard.
*   **Large Files**: Files over 10MB are rejected by Express Multer limits automatically to safeguard memory performance.
*   **Malformed Rows**: Papa Parse greedily skips completely empty rows, correcting for trailing comma spaces or broken carriage returns.
