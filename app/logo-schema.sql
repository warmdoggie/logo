CREATE TABLE IF NOT EXISTS OriginalLogoVersion (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id), version INTEGER NOT NULL,
 legacyLogoAssetId TEXT UNIQUE REFERENCES LogoAsset(id), filePath TEXT NOT NULL, previewPath TEXT NOT NULL,
 fileName TEXT NOT NULL, mimeType TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(taskId,version)
);
CREATE TABLE IF NOT EXISTS LogoElement (
 id TEXT PRIMARY KEY, logoAssetId TEXT NOT NULL REFERENCES OriginalLogoVersion(id), name TEXT NOT NULL,
 elementType TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL,
 isFull INTEGER NOT NULL DEFAULT 0, isArchived INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL,
 CHECK(x>=0 AND y>=0 AND width>0 AND height>0 AND x+width<=1.000001 AND y+height<=1.000001)
);
CREATE INDEX IF NOT EXISTS idx_LogoElement_source ON LogoElement(logoAssetId);
CREATE TABLE IF NOT EXISTS ProductionLogo (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id), version INTEGER NOT NULL,
 sourceLogoAssetId TEXT NOT NULL REFERENCES OriginalLogoVersion(id), colorMode TEXT NOT NULL,
 estimatedColorCount INTEGER, colorCount INTEGER, primaryColor TEXT, secondaryColor TEXT, pantoneNote TEXT NOT NULL,
 hasGradient INTEGER, hasTransparency INTEGER, hasShadow INTEGER, analysisConfidence TEXT NOT NULL,
 needsManualReview INTEGER NOT NULL, analysisJson TEXT NOT NULL, backgroundRemovalMode TEXT NOT NULL,
 tolerance INTEGER NOT NULL, filePath TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 selectionJson TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(taskId,version)
);
CREATE TABLE IF NOT EXISTS ProductionLogoElement (
 id TEXT PRIMARY KEY, productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id), logoElementId TEXT NOT NULL REFERENCES LogoElement(id),
 UNIQUE(productionLogoId,logoElementId)
);
CREATE TABLE IF NOT EXISTS LogoUsageReference (
 id TEXT PRIMARY KEY, productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id), mockupId TEXT NOT NULL,
 UNIQUE(productionLogoId,mockupId)
);
