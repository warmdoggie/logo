PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS Product (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, category TEXT NOT NULL, standardImage TEXT NOT NULL,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, subcategory TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS Task (
 id TEXT PRIMARY KEY, taskCode TEXT NOT NULL UNIQUE,
 customerName TEXT NOT NULL, rawRequirement TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT '待处理', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS LogoAsset (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL UNIQUE REFERENCES Task(id) ON DELETE CASCADE,
 fileName TEXT NOT NULL, filePath TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS TaskProduct (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id) ON DELETE CASCADE,
 productId TEXT NOT NULL REFERENCES Product(id), UNIQUE(taskId, productId)
);
CREATE INDEX IF NOT EXISTS idx_Task_createdAt ON Task(createdAt DESC);
CREATE TABLE IF NOT EXISTS AppMeta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ProductTemplate (
 id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES Product(id),
 version INTEGER NOT NULL CHECK(version > 0), isCurrent INTEGER NOT NULL CHECK(isCurrent IN (0,1)),
 changeNote TEXT NOT NULL, standardImage TEXT NOT NULL, createdAt TEXT NOT NULL,
 UNIQUE(productId, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ProductTemplate_current ON ProductTemplate(productId) WHERE isCurrent=1;
CREATE TABLE IF NOT EXISTS TemplateZone (
 id TEXT PRIMARY KEY, templateId TEXT NOT NULL REFERENCES ProductTemplate(id),
 zoneType TEXT NOT NULL CHECK(zoneType IN ('logo','no-logo')), name TEXT NOT NULL,
 x REAL NOT NULL CHECK(x>=0 AND x<=1), y REAL NOT NULL CHECK(y>=0 AND y<=1),
 width REAL NOT NULL CHECK(width>0 AND width<=1), height REAL NOT NULL CHECK(height>0 AND height<=1),
 defaultAnchorX REAL, defaultAnchorY REAL, maxLogoWidthRatio REAL, maxLogoHeightRatio REAL,
 defaultRotation REAL, allowRotation INTEGER, orientation TEXT, isDefault INTEGER, note TEXT NOT NULL DEFAULT '',
 CHECK(x+width<=1.000001 AND y+height<=1.000001)
);
CREATE INDEX IF NOT EXISTS idx_TemplateZone_templateId ON TemplateZone(templateId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_TemplateZone_default ON TemplateZone(templateId) WHERE isDefault=1;
CREATE TABLE IF NOT EXISTS TaskProductTemplate (
 taskProductId TEXT PRIMARY KEY REFERENCES TaskProduct(id),
 templateId TEXT NOT NULL REFERENCES ProductTemplate(id)
);
