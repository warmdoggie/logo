CREATE TABLE IF NOT EXISTS Rule (
 id TEXT PRIMARY KEY, ruleCode TEXT NOT NULL, name TEXT NOT NULL, scopeType TEXT NOT NULL,
 resultType TEXT NOT NULL, hardness TEXT NOT NULL, businessMessage TEXT NOT NULL, internalNote TEXT NOT NULL,
 recommendedAction TEXT NOT NULL, recommendedProcess TEXT, version INTEGER NOT NULL, enabled INTEGER NOT NULL,
 isCurrent INTEGER NOT NULL, isExample INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
 createdBy TEXT NOT NULL, UNIQUE(ruleCode,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_Rule_current ON Rule(ruleCode) WHERE isCurrent=1;
CREATE TABLE IF NOT EXISTS RuleCondition (
 id TEXT PRIMARY KEY, ruleId TEXT NOT NULL REFERENCES Rule(id), field TEXT NOT NULL, operator TEXT NOT NULL, value TEXT
);
CREATE INDEX IF NOT EXISTS idx_RuleCondition_ruleId ON RuleCondition(ruleId);
CREATE TABLE IF NOT EXISTS ProcessPolicy (
 id TEXT PRIMARY KEY, processType TEXT NOT NULL, version INTEGER NOT NULL, requiresFields TEXT NOT NULL,
 requireExplicitApproval INTEGER NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(processType,version)
);
CREATE TABLE IF NOT EXISTS ProductProcessProfile (
 id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES Product(id), version INTEGER NOT NULL,
 material TEXT, surfaceFinish TEXT, note TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(productId,version)
);
CREATE TABLE IF NOT EXISTS LogoRuleFacts (
 id TEXT PRIMARY KEY, productionLogoId TEXT NOT NULL REFERENCES ProductionLogo(id), version INTEGER NOT NULL,
 logoColorCount INTEGER, hasGradient INTEGER, hasTransparency INTEGER, note TEXT NOT NULL,
 createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(productionLogoId,version)
);
CREATE TABLE IF NOT EXISTS TaskProcessSelection (
 taskProductId TEXT PRIMARY KEY REFERENCES TaskProduct(id), processType TEXT, selectedTemplateAreaId TEXT REFERENCES TemplateZone(id), updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS RuleEvaluationRun (
 id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES Task(id), taskProductId TEXT NOT NULL REFERENCES TaskProduct(id),
 productionLogoId TEXT REFERENCES ProductionLogo(id), processType TEXT, overallStatus TEXT NOT NULL,
 contextSnapshot TEXT NOT NULL, rulesSnapshot TEXT NOT NULL, fingerprint TEXT NOT NULL, testOnly INTEGER NOT NULL, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_RuleEvaluationRun_task ON RuleEvaluationRun(taskId,createdAt DESC);
CREATE TABLE IF NOT EXISTS TaskRuleEvaluation (
 id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES RuleEvaluationRun(id), taskId TEXT NOT NULL REFERENCES Task(id),
 taskProductId TEXT NOT NULL REFERENCES TaskProduct(id), productionLogoId TEXT REFERENCES ProductionLogo(id), processType TEXT,
 ruleId TEXT REFERENCES Rule(id), ruleVersion INTEGER, result TEXT NOT NULL, hardness TEXT NOT NULL,
 message TEXT NOT NULL, recommendation TEXT NOT NULL, contextSnapshot TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_TaskRuleEvaluation_run ON TaskRuleEvaluation(runId);
CREATE TABLE IF NOT EXISTS EvaluationConfirmation (
 id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES RuleEvaluationRun(id), confirmedBy TEXT NOT NULL,
 role TEXT NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS RuleUser (username TEXT PRIMARY KEY, role TEXT NOT NULL, salt TEXT NOT NULL, passwordHash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS RuleSession (tokenHash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES RuleUser(username), expiresAt INTEGER NOT NULL);
