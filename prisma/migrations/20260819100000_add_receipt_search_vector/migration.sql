-- Phase 2 session 3: real full-text search.
--
-- The column is maintained by triggers rather than computed per query.
-- Computing to_tsvector() at query time cannot use an index, so it degrades
-- linearly with the vault and would have to be replaced the moment search
-- mattered. A stored vector with a GIN index is the version that keeps
-- working.

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "searchVector" tsvector;

-- The document, and its weighting. A merchant name is the strongest signal
-- ("find my Talabat receipt"), an item name is next ("flat white"), and a
-- note is the weakest because it is free text the user wrote for themselves.
-- ts_rank reads these weights, so ordering falls out of the data rather than
-- needing a hand-tuned score.
CREATE OR REPLACE FUNCTION receipt_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce((SELECT m.name FROM "Merchant" m WHERE m.id = NEW."merchantId"), '')), 'A') ||
    setweight(to_tsvector('english', coalesce((SELECT string_agg(i.name, ' ') FROM "ReceiptItem" i WHERE i."receiptId" = NEW.id), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE, so it assigns to NEW and never issues an UPDATE of its own. An
-- AFTER trigger that updated the same table would re-fire itself, and the
-- usual guard against that recursion is subtle enough to get wrong later.
CREATE TRIGGER receipt_search_vector_trg
  BEFORE INSERT OR UPDATE ON "Receipt"
  FOR EACH ROW EXECUTE FUNCTION receipt_search_vector_update();

-- Items are inserted *after* their receipt (Prisma's nested create), so the
-- receipt's own INSERT cannot see them. Without this, every item name would
-- be missing from the index of the receipt that owns it — the single most
-- likely way for this feature to look like it works and quietly not.
--
-- Writing NULL is deliberate: the UPDATE fires the BEFORE trigger above,
-- which recomputes the real value. One definition of the document, not two.
CREATE OR REPLACE FUNCTION receipt_item_refresh_search_vector() RETURNS trigger AS $$
BEGIN
  UPDATE "Receipt" SET "searchVector" = NULL WHERE id = COALESCE(NEW."receiptId", OLD."receiptId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_item_search_vector_trg
  AFTER INSERT OR UPDATE OR DELETE ON "ReceiptItem"
  FOR EACH ROW EXECUTE FUNCTION receipt_item_refresh_search_vector();

-- Merchants are shared, so renaming one has to re-index every receipt that
-- points at it.
CREATE OR REPLACE FUNCTION merchant_refresh_search_vectors() RETURNS trigger AS $$
BEGIN
  UPDATE "Receipt" SET "searchVector" = NULL WHERE "merchantId" = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchant_search_vector_trg
  AFTER UPDATE OF name ON "Merchant"
  FOR EACH ROW EXECUTE FUNCTION merchant_refresh_search_vectors();

-- Backfill every existing row through the same trigger, so historic
-- receipts are indexed by exactly the definition new ones use.
UPDATE "Receipt" SET "searchVector" = NULL;

-- CreateIndex
CREATE INDEX "Receipt_searchVector_idx" ON "Receipt" USING GIN ("searchVector");
