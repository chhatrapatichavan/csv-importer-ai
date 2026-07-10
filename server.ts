import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import Papa from "papaparse";
import { mapBatchWithAI, MappedBatchItem } from "./server/geminiService.ts";
import { CRMRecord, ImportResult } from "./src/types.ts";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up Multer with Memory Storage for handling CSV files up to 10MB
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".csv" || file.mimetype === "text/csv" || file.mimetype === "application/vnd.ms-excel") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed."));
    }
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API endpoint for health check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Helper function to extract AI API error details and map to HTTP statuses/types
function getAIErrorDetails(err: any): { isGlobalError: boolean; status: number; errorType: string; message: string } {
  const msg = String(err?.message || "").toLowerCase();
  const status = Number(err?.status || err?.statusCode || err?.code || 0);

  let isGlobalError = false;
  let errorType = "other";
  let message = err?.message || "An unexpected error occurred.";

  // Detect 429 / Quota Exceeded
  if (status === 429 || msg.includes("429") || msg.includes("quota") || msg.includes("limit exceeded") || msg.includes("rate_limit") || msg.includes("resource_exhausted") || msg.includes("exhausted")) {
    isGlobalError = true;
    errorType = "quota";
    message = "AI API quota exceeded. Please try again later.";
    return { isGlobalError, status: 429, errorType, message };
  }

  // Detect Invalid API Key
  if (status === 400 && (msg.includes("api key not valid") || msg.includes("invalid api key") || msg.includes("key not valid") || msg.includes("api key"))) {
    isGlobalError = true;
    errorType = "auth";
    message = "AI API key is invalid. Please check your API key in the .env file.";
    return { isGlobalError, status: 400, errorType, message };
  }

  // Detect Timeout
  if (status === 504 || status === 408 || msg.includes("timeout") || msg.includes("deadline") || msg.includes("timed out") || msg.includes("etimedout") || msg.includes("aborted")) {
    isGlobalError = true;
    errorType = "timeout";
    message = "AI API request timed out. Please try again.";
    return { isGlobalError, status: 504, errorType, message };
  }

  // Detect 500 / Server Error
  if (status === 500 || status === 502 || status === 503 || msg.includes("500") || msg.includes("internal server error") || msg.includes("service unavailable") || msg.includes("server error")) {
    isGlobalError = true;
    errorType = "server";
    message = "AI API server error occurred. Please try again.";
    return { isGlobalError, status: status || 500, errorType, message };
  }

  return { isGlobalError, status: status || 500, errorType, message };
}

// Main AI CRM CSV Importer endpoint
app.post("/api/import", upload.single("file"), async (req, res): Promise<any> => {
  let totalRecords = 0;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded. Please upload a valid CSV." });
    }

    const csvBuffer = req.file.buffer.toString("utf-8");
    if (!csvBuffer || csvBuffer.trim() === "") {
      return res.status(400).json({ success: false, error: "The uploaded CSV file is empty." });
    }

    // Parse CSV with PapaParse
    const parseResult = Papa.parse(csvBuffer, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
    });

    if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
      console.error("CSV Parse Errors:", parseResult.errors);
      return res.status(400).json({
        success: false,
        error: "Malformed CSV file. Could not parse rows.",
        details: parseResult.errors
      });
    }

    const rawRows = parseResult.data as Record<string, any>[];
    totalRecords = rawRows.length;

    if (totalRecords === 0) {
      return res.status(400).json({ success: false, error: "No records found in CSV file." });
    }

    console.log(`Starting import processing of ${totalRecords} rows in batches of 20...`);

    const batchSize = 20;
    const finalRecords: CRMRecord[] = [];
    const skippedRecords: Array<{ row: number; reason: string; data: any }> = [];
    let importedCount = 0;
    let skippedCount = 0;

    // Distributions for summary dashboard
    const statusDistribution: Record<string, number> = {};
    const dataSourceDistribution: Record<string, number> = {};

    // Helper function to process a batch with automatic retry logic
    const processBatchWithRetry = async (
      batch: Record<string, any>[],
      startIndex: number,
      retriesLeft = 2
    ): Promise<MappedBatchItem[]> => {
      try {
        return await mapBatchWithAI(batch, startIndex);
      } catch (err: any) {
        if (retriesLeft > 0) {
          console.warn(`Batch processing failed at index ${startIndex}. Retrying... (${retriesLeft} attempts left)`);
          // Exponential backoff delay
          await new Promise(resolve => setTimeout(resolve, (3 - retriesLeft) * 1000));
          return processBatchWithRetry(batch, startIndex, retriesLeft - 1);
        } else {
          console.error(`Batch processing permanently failed at index ${startIndex} after all retries.`);
          throw err;
        }
      }
    };

    // Iterate in batches of 20
    for (let i = 0; i < totalRecords; i += batchSize) {
      const batch = rawRows.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(totalRecords / batchSize)} (Index: ${i} to ${i + batch.length})`);

      try {
        const batchResults = await processBatchWithRetry(batch, i, 2);

        for (const item of batchResults) {
          // Resolve originalRowData safely supporting both absolute and relative indexes
          const idx = item.original_index;
          let originalRowData: Record<string, any> = {};
          let actualRowNumber = i + 1; // Fallback row number

          if (idx >= i && idx < i + batch.length) {
            // idx is absolute
            originalRowData = rawRows[idx] || batch[idx - i] || {};
            actualRowNumber = idx + 1;
          } else if (idx >= 0 && idx < batch.length) {
            // idx is relative to this batch
            originalRowData = batch[idx] || rawRows[i + idx] || {};
            actualRowNumber = i + idx + 1;
          } else {
            // Fallback matching by sequence
            const batchIdx = batchResults.indexOf(item);
            if (batchIdx !== -1 && batchIdx < batch.length) {
              originalRowData = batch[batchIdx];
              actualRowNumber = i + batchIdx + 1;
            } else {
              originalRowData = batch[0] || {};
              actualRowNumber = i + 1;
            }
          }

          if (item.skipped || !item.mapped_record) {
            skippedCount++;
            skippedRecords.push({
              row: actualRowNumber,
              reason: item.skip_reason || "Filtered out by AI constraints.",
              data: originalRowData
            });
          } else {
            const mapped: CRMRecord = item.mapped_record;
            
            // Post-AI fallback safety validation - only skip if completely empty (has no meaningful data fields populated)
            const meaningfulFields = [
              mapped.name,
              mapped.email,
              mapped.mobile_without_country_code,
              mapped.company,
              mapped.city,
              mapped.state,
              mapped.country,
              mapped.description,
              mapped.crm_note
            ];
            const hasMeaningfulData = meaningfulFields.some(val => val && String(val).trim() !== "");
            if (!hasMeaningfulData) {
              skippedCount++;
              skippedRecords.push({
                row: actualRowNumber,
                reason: "Secondary validation: Record contains no meaningful data.",
                data: originalRowData
              });
              continue;
            }

            importedCount++;
            finalRecords.push(mapped);

            // Populate distributions
            const status = mapped.crm_status || "UNKNOWN";
            statusDistribution[status] = (statusDistribution[status] || 0) + 1;

            const source = mapped.data_source || "UNKNOWN";
            dataSourceDistribution[source] = (dataSourceDistribution[source] || 0) + 1;
          }
        }
      } catch (batchError: any) {
        // Check if this is a global AI API error (quota, server error, or timeout)
        const errDetails = getAIErrorDetails(batchError);
        if (errDetails.isGlobalError) {
          console.error(`Global AI API error encountered in batch starting at row ${i + 1}. Aborting mapping flow.`);
          // Propagate the error so we abort immediately and do not mark everything as skipped!
          throw batchError;
        }

        // If a batch permanently fails due to a local/formatting error, skip it and continue importing remaining records
        console.error(`Skipping batch starting at row ${i + 1} due to unrecoverable non-global errors:`, batchError.message);
        
        batch.forEach((row, idx) => {
          skippedCount++;
          skippedRecords.push({
            row: i + idx + 1,
            reason: `Batch API Error: ${batchError.message || "Failed to contact AI mapping service"}`,
            data: row
          });
        });
      }
    }

    const responseData: ImportResult = {
      success: true,
      importedCount,
      imported: importedCount,
      skippedCount,
      skipped: skippedCount,
      records: finalRecords,
      skippedRecords,
      summary: {
        totalProcessed: totalRecords,
        successful: importedCount,
        skipped: skippedCount,
        statusDistribution,
        dataSourceDistribution
      }
    };

    return res.json(responseData);

  } catch (error: any) {
    console.error("Critical error inside /api/import:", error);
    const errDetails = getAIErrorDetails(error);

    if (errDetails.isGlobalError) {
      return res.status(errDetails.status).json({
        success: false,
        errorType: errDetails.errorType,
        error: errDetails.message,
        details: error.message,
        imported: 0,
        skipped: 0,
        failedCount: totalRecords,
        records: []
      });
    }

    return res.status(500).json({
      success: false,
      errorType: "other",
      error: "An unexpected server error occurred during CSV import.",
      imported: 0,
      skipped: 0,
      records: [],
      details: error.message
    });
  }
});

// Global API error handler - guarantees JSON formatting instead of standard HTML pages
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global error handler caught an exception:", err);
  
  if (req.path.startsWith("/api") || req.xhr) {
    return res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: err.message || "An unexpected server error occurred.",
      imported: 0,
      skipped: 0,
      records: [],
      details: typeof err === "object" && err !== null ? err.stack || err.message : String(err)
    });
  }
  
  next(err);
});

// Setup development dev server or production asset server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving compiled static production files from dist/.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI CSV Importer application running on port ${PORT}`);
  });
}

startServer();
