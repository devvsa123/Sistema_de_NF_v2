//go:build windows

package main

// Rede pelo WinINet, o mesmo componente que o Windows/Edge usam: respeita o proxy corporativo configurado
// no Windows (inclusive script PAC) e a autenticação do usuário logado na rede (NTLM/Kerberos).

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	wininet              = windows.NewLazySystemDLL("wininet.dll")
	pInternetOpen        = wininet.NewProc("InternetOpenW")
	pInternetConnect     = wininet.NewProc("InternetConnectW")
	pHttpOpenRequest     = wininet.NewProc("HttpOpenRequestW")
	pHttpSendRequest     = wininet.NewProc("HttpSendRequestW")
	pHttpQueryInfo       = wininet.NewProc("HttpQueryInfoW")
	pInternetReadFile    = wininet.NewProc("InternetReadFile")
	pInternetCloseHandle = wininet.NewProc("InternetCloseHandle")
	pInternetSetOption   = wininet.NewProc("InternetSetOptionW")
	pInternetQueryOption = wininet.NewProc("InternetQueryOptionW")
)

const (
	internetOpenTypePreconfig   = 0
	internetServiceHTTP         = 3
	internetFlagSecure          = 0x00800000
	internetFlagReload          = 0x80000000
	internetFlagNoCacheWrite    = 0x04000000
	internetFlagKeepConnection  = 0x00400000
	internetFlagNoCookies       = 0x00080000
	internetFlagNoUI            = 0x00000200
	httpQueryStatusCode         = 19
	httpQueryContentDisposition = 47
	httpQueryFlagNumber         = 0x20000000
	optConnectTimeout           = 2
	optSendTimeout              = 5
	optReceiveTimeout           = 6
	optSecurityCertificate      = 35
	errInvalidCA                = 12045
	// identifica-se como o navegador: alguns proxies tratam programas desconhecidos de outro jeito
	agente = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0 AssinaNF"
)

type respostaHTTP struct {
	status     int
	corpo      []byte
	disposicao string
}

func (r respostaHTTP) nomeArquivo() string {
	if _, p, err := mime.ParseMediaType(r.disposicao); err == nil {
		return p["filename"]
	}
	return ""
}

func u16(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

// requisicao tenta pelo WinINet (proxy do Windows); se não der, tenta direto.
func requisicao(metodo, endereco string, cabecalhos map[string]string, corpo []byte) (respostaHTTP, error) {
	r, err := wininetReq(metodo, endereco, cabecalhos, corpo)
	if err == nil {
		return r, nil
	}
	log.Printf("WinINet falhou (%v); tentando conexão direta", err)
	r2, err2 := diretoReq(metodo, endereco, cabecalhos, corpo)
	if err2 != nil {
		return r2, fmt.Errorf("%v (pela rede do Windows: %v)", err2, err)
	}
	return r2, nil
}

func wininetReq(metodo, endereco string, cabecalhos map[string]string, corpo []byte) (respostaHTTP, error) {
	var res respostaHTTP
	u, err := url.Parse(endereco)
	if err != nil {
		return res, err
	}
	hInet, _, e := pInternetOpen.Call(uintptr(unsafe.Pointer(u16(agente))), internetOpenTypePreconfig, 0, 0, 0)
	if hInet == 0 {
		return res, fmt.Errorf("InternetOpen: %v", e)
	}
	defer pInternetCloseHandle.Call(hInet)
	for _, op := range []uintptr{optConnectTimeout, optSendTimeout, optReceiveTimeout} {
		ms := uint32(60000)
		pInternetSetOption.Call(hInet, op, uintptr(unsafe.Pointer(&ms)), 4)
	}
	porta := u.Port()
	var nPorta uintptr = 443
	if u.Scheme == "http" {
		nPorta = 80
	}
	if porta != "" {
		var p int
		fmt.Sscanf(porta, "%d", &p)
		nPorta = uintptr(p)
	}
	hConn, _, e := pInternetConnect.Call(hInet, uintptr(unsafe.Pointer(u16(u.Hostname()))), nPorta, 0, 0, internetServiceHTTP, 0, 0)
	if hConn == 0 {
		return res, fmt.Errorf("InternetConnect: %v", e)
	}
	defer pInternetCloseHandle.Call(hConn)
	flags := uintptr(internetFlagReload | internetFlagNoCacheWrite | internetFlagKeepConnection | internetFlagNoCookies | internetFlagNoUI)
	if u.Scheme == "https" {
		flags |= internetFlagSecure
	}
	caminho := u.RequestURI()
	hReq, _, e := pHttpOpenRequest.Call(hConn, uintptr(unsafe.Pointer(u16(metodo))), uintptr(unsafe.Pointer(u16(caminho))), 0, 0, 0, flags, 0)
	if hReq == 0 {
		return res, fmt.Errorf("HttpOpenRequest: %v", e)
	}
	defer pInternetCloseHandle.Call(hReq)
	var cab strings.Builder
	for k, v := range cabecalhos {
		cab.WriteString(k + ": " + v + "\r\n")
	}
	cabStr := cab.String()
	var pCab *uint16
	var nCab uintptr
	if cabStr != "" {
		pCab = u16(cabStr)
		nCab = uintptr(len(windows.StringToUTF16(cabStr)) - 1)
	}
	var pCorpo uintptr
	if len(corpo) > 0 {
		pCorpo = uintptr(unsafe.Pointer(&corpo[0]))
	}
	ok, _, e := pHttpSendRequest.Call(hReq, uintptr(unsafe.Pointer(pCab)), nCab, pCorpo, uintptr(len(corpo)))
	if ok == 0 && e == windows.Errno(errInvalidCA) {
		// só registra o certificado apresentado (diagnóstico); a conexão não é aceita
		cert := certificado(hReq)
		log.Printf("certificado não confiável pelo Windows (12045): %s", cert)
		return res, fmt.Errorf("o Windows não confia no certificado apresentado pela rede (erro 12045). Certificado: %s", cert)
	}
	if ok == 0 {
		return res, fmt.Errorf("HttpSendRequest: %v", e)
	}
	var status, tam uint32 = 0, 4
	pHttpQueryInfo.Call(hReq, httpQueryStatusCode|httpQueryFlagNumber, uintptr(unsafe.Pointer(&status)), uintptr(unsafe.Pointer(&tam)), 0)
	res.status = int(status)
	buf := make([]uint16, 1024)
	tam = uint32(len(buf) * 2)
	if r, _, _ := pHttpQueryInfo.Call(hReq, httpQueryContentDisposition, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&tam)), 0); r != 0 {
		res.disposicao = windows.UTF16ToString(buf[:tam/2])
	}
	var saida bytes.Buffer
	pedaco := make([]byte, 64*1024)
	for {
		var lidos uint32
		r, _, e := pInternetReadFile.Call(hReq, uintptr(unsafe.Pointer(&pedaco[0])), uintptr(len(pedaco)), uintptr(unsafe.Pointer(&lidos)))
		if r == 0 {
			return res, fmt.Errorf("InternetReadFile: %v", e)
		}
		if lidos == 0 {
			break
		}
		saida.Write(pedaco[:lidos])
	}
	res.corpo = saida.Bytes()
	if res.status == 407 {
		return res, fmt.Errorf("o proxy da rede pediu autenticação (407)")
	}
	return res, nil
}

func diretoReq(metodo, endereco string, cabecalhos map[string]string, corpo []byte) (respostaHTTP, error) {
	var res respostaHTTP
	req, err := http.NewRequest(metodo, endereco, bytes.NewReader(corpo))
	if err != nil {
		return res, err
	}
	for k, v := range cabecalhos {
		req.Header.Set(k, v)
	}
	r, err := (&http.Client{Timeout: 2 * time.Minute}).Do(req)
	if err != nil {
		return res, err
	}
	defer r.Body.Close()
	res.status = r.StatusCode
	res.disposicao = r.Header.Get("Content-Disposition")
	res.corpo, err = io.ReadAll(r.Body)
	return res, err
}

// certificado descreve o certificado apresentado na conexão (emissor, titular, validade), para diagnóstico.
func certificado(hReq uintptr) string {
	buf := make([]uint16, 4096)
	tam := uint32(len(buf) * 2)
	if r, _, _ := pInternetQueryOption.Call(hReq, optSecurityCertificate, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&tam))); r == 0 {
		return "(não foi possível ler)"
	}
	return strings.Join(strings.Fields(windows.UTF16ToString(buf)), " ")
}
