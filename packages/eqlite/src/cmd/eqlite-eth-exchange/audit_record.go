
package main

import (
	"encoding/json"
	"time"

	gorp "gopkg.in/gorp.v2"
)

// AuditRecord defines the eth exchange audit record object.
type AuditRecord struct {
	ID      int64       `db:"id"`
	Hash    string      `db:"hash"`
	Time    int64       `db:"time"`
	Op      string      `db:"op"`
	RawData []byte      `db:"data"`
	Data    interface{} `db:"-"`
	Error   string      `db:"error"`
}

// PostGet implements gorp.HasPostGet interface.
func (r *AuditRecord) PostGet(gorp.SqlExecutor) error {
	return r.Deserialize()
}

// PreUpdate implements gorp.HasPreUpdate interface.
func (r *AuditRecord) PreUpdate(gorp.SqlExecutor) error {
	return r.Serialize()
}

// PreInsert implements gorp.HasPreInsert interface.
func (r *AuditRecord) PreInsert(gorp.SqlExecutor) error {
	return r.Serialize()
}

// Serialize marshal record object to byte format.
func (r *AuditRecord) Serialize() (err error) {
	r.RawData, err = json.Marshal(r.Data)
	return
}

// Deserialize unmarshal record bytes to object.
func (r *AuditRecord) Deserialize() (err error) {
	err = json.Unmarshal(r.RawData, &r.Data)
	return
}

// AddAuditRecord saves new record.
func AddAuditRecord(db *gorp.DbMap, r *AuditRecord) (err error) {
	r.Time = time.Now().Unix()
	err = db.Insert(r)
	return
}

// FindAuditRecords find audit records.
func FindAuditRecords(db *gorp.DbMap, h string, fromTime int64, toTime int64, offset int64, limit int64) (err error) {
	// TODO():
	return
}
