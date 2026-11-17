CREATE TABLE IF NOT EXISTS ProductImageVersion (
 id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES Product(id), imagePath TEXT NOT NULL,
 sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, createdAt TEXT NOT NULL,
 UNIQUE(productId,imagePath,sha256)
);
CREATE TABLE IF NOT EXISTS TaskStyleMaster (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id), version INTEGER NOT NULL,
 productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id), processType TEXT NOT NULL,
 colorMode TEXT NOT NULL, visualMode TEXT NOT NULL, sourceMockupJobId TEXT NOT NULL REFERENCES MockupJob(id),
 sourceMockupVersionId TEXT NOT NULL UNIQUE REFERENCES MockupVersion(id), createdAt TEXT NOT NULL,
 UNIQUE(taskId,version)
);
CREATE TABLE IF NOT EXISTS MockupJob (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id), taskProductId TEXT NOT NULL UNIQUE REFERENCES TaskProduct(id),
 taskStyleMasterId TEXT REFERENCES TaskStyleMaster(id), status TEXT NOT NULL,
 productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id), productImageVersionId TEXT NOT NULL REFERENCES ProductImageVersion(id),
 templateVersionId TEXT NOT NULL REFERENCES ProductTemplate(id), selectedZoneId TEXT REFERENCES TemplateZone(id),
 logoX REAL NOT NULL, logoY REAL NOT NULL, logoWidthRatio REAL NOT NULL, logoRotation REAL NOT NULL,
 processType TEXT, revision INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS MockupVersion (
 id TEXT PRIMARY KEY, mockupJobId TEXT NOT NULL REFERENCES MockupJob(id), version INTEGER NOT NULL,
 imagePath TEXT NOT NULL, productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id),
 productImageVersionId TEXT NOT NULL REFERENCES ProductImageVersion(id), templateVersionId TEXT NOT NULL REFERENCES ProductTemplate(id),
 ruleEvaluationSnapshotId TEXT NOT NULL REFERENCES RuleEvaluationRun(id), snapshot TEXT NOT NULL,
 status TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(mockupJobId,version)
);
CREATE TABLE IF NOT EXISTS MockupReview (
 id TEXT PRIMARY KEY, mockupVersionId TEXT NOT NULL REFERENCES MockupVersion(id), action TEXT NOT NULL,
 checks TEXT NOT NULL, reviewedBy TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS TaskWorkspaceState (
 taskId TEXT PRIMARY KEY REFERENCES Task(id), firstTaskProductId TEXT NOT NULL REFERENCES TaskProduct(id),
 status TEXT NOT NULL, taskStyleMasterId TEXT REFERENCES TaskStyleMaster(id), revision INTEGER NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_MockupJob_task ON MockupJob(taskId);
CREATE INDEX IF NOT EXISTS idx_MockupReview_version ON MockupReview(mockupVersionId);
