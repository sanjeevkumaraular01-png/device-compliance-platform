package activity

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

// NativeHostName is the Chrome/Edge native messaging host name.
const NativeHostName = "com.secureendpoint.agent"

// maxNativeMessage caps browser -> host messages (Chrome allows 64 MiB; we only need a hostname).
const maxNativeMessage = 64 << 10

// TabMessage is what the extension sends: the hostname only.
type TabMessage struct {
	Host    string `json:"host"`
	Browser string `json:"browser"`
}

// ReadNativeMessage reads one Chrome native-messaging frame
// (uint32 little-endian length + UTF-8 JSON).
func ReadNativeMessage(r io.Reader, v any) error {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return err
	}
	if n == 0 || n > maxNativeMessage {
		return errors.New("native message size out of range")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	return json.Unmarshal(buf, v)
}

// WriteNativeMessage writes one frame back to the browser.
func WriteNativeMessage(w io.Writer, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(b))); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

// ServeNativeHost handles messages from the extension until the browser
// closes stdin, storing each sanitized hostname for the helper.
func ServeNativeHost(in io.Reader, out io.Writer) error {
	for {
		var m TabMessage
		if err := ReadNativeMessage(in, &m); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		_ = WriteActiveDomain(m.Host, m.Browser)
		_ = WriteNativeMessage(out, map[string]bool{"ok": true})
	}
}
