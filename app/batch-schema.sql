CREATE TABLE IF NOT EXISTS TaskStyleRevision (
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),version INTEGER NOT NULL,
 baseStyleMasterId TEXT NOT NULL REFERENCES TaskStyleMaster(id),previousStyleId TEXT NOT NULL,
 productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id),processType TEXT NOT NULL,
 colorMode TEXT NOT NULL,visualMode TEXT NOT NULL,reason TEXT NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,
 UNIQUE(taskId,version)
);
CREATE TABLE IF NOT EXISTS BatchJob (
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),taskStyleMasterId TEXT NOT NULL REFERENCES TaskStyleMaster(id),
 styleRevisionId TEXT REFERENCES TaskStyleRevision(id),productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id),
 mode TEXT NOT NULL,status TEXT NOT NULL,totalCount INTEGER NOT NULL,createdAt TEXT NOT NULL,startedAt TEXT,completedAt TEXT
);
CREATE TABLE IF NOT EXISTS BatchItem (
 id TEXT PRIMARY KEY,batchJobId TEXT NOT NULL REFERENCES BatchJob(id),taskProductId TEXT NOT NULL REFERENCES TaskProduct(id),
 mockupJobId TEXT REFERENCES MockupJob(id),status TEXT NOT NULL,preflightResult TEXT,parameters TEXT,
 warningConfirmation TEXT,errorCode TEXT,errorMessage TEXT,attempt INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
 UNIQUE(batchJobId,taskProductId)
);
CREATE TABLE IF NOT EXISTS BatchAttempt (
 id TEXT PRIMARY KEY,batchItemId TEXT NOT NULL REFERENCES BatchItem(id),attempt INTEGER NOT NULL,
 event TEXT NOT NULL,snapshot TEXT NOT NULL,createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS BatchOutput (
 mockupVersionId TEXT PRIMARY KEY REFERENCES MockupVersion(id),batchJobId TEXT NOT NULL REFERENCES BatchJob(id),
 batchItemId TEXT NOT NULL REFERENCES BatchItem(id),attempt INTEGER NOT NULL,
 taskStyleMasterId TEXT NOT NULL REFERENCES TaskStyleMaster(id),styleRevisionId TEXT REFERENCES TaskStyleRevision(id),
 createdAt TEXT NOT NULL,UNIQUE(batchItemId,attempt)
);
CREATE TABLE IF NOT EXISTS BatchExport (
 id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES Task(id),fileName TEXT NOT NULL,manifest TEXT NOT NULL,
 sha256 TEXT NOT NULL,createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_BatchJob_task ON BatchJob(taskId,createdAt);
CREATE INDEX IF NOT EXISTS idx_BatchItem_status ON BatchItem(batchJobId,status);
CREATE INDEX IF NOT EXISTS idx_BatchAttempt_item ON BatchAttempt(batchItemId,attempt);
