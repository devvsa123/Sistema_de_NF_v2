//go:build windows

// Assistente de Assinatura do Sistema de Tramitação de NF.
//
// Instalação: dar dois cliques no AssinaNF.exe. Ele se copia para %LOCALAPPDATA%\AssinaNF e registra o
// endereço "assinanf://" para o usuário atual (não precisa de administrador).
//
// Uso: no sistema, "Assinar no Adobe" abre assinanf://assinar?u=<endereço do documento>. O Assistente baixa o
// PDF para Documentos\Assinaturas NF, abre no Adobe, espera o arquivo assinado ser salvo, envia para o sistema
// (que confere a assinatura e anexa na NF) e fecha o documento no Adobe.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	versao    = "1.1.0"
	titulo    = "Assistente de Assinatura — Tramitação de NF"
	protocolo = "assinanf"
	espera    = 45 * time.Minute
)

// Endereços do sistema aceitos (o Assistente não fala com outros sites).
var hostsPermitidos = []string{"sistemadenf.vercel.app", "localhost", "127.0.0.1"}

var (
	user32           = windows.NewLazySystemDLL("user32.dll")
	pMessageBox      = user32.NewProc("MessageBoxW")
	pEnumWindows     = user32.NewProc("EnumWindows")
	pGetWindowText   = user32.NewProc("GetWindowTextW")
	pIsWindowVisible = user32.NewProc("IsWindowVisible")
	pPostMessage     = user32.NewProc("PostMessageW")
	pSetForeground   = user32.NewProc("SetForegroundWindow")
)

const (
	mbOK          = 0x0
	mbIconInfo    = 0x40
	mbIconWarning = 0x30
	mbIconError   = 0x10
	mbTopmost     = 0x40000
	wmClose       = 0x0010
)

func mensagem(texto string, icone uintptr) {
	t, _ := windows.UTF16PtrFromString(texto)
	c, _ := windows.UTF16PtrFromString(titulo)
	pMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), mbOK|icone|mbTopmost)
}

func pastaApp() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "AssinaNF")
}

func main() {
	_ = os.MkdirAll(pastaApp(), 0o755)
	if f, err := os.OpenFile(filepath.Join(pastaApp(), "assinanf.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(f)
		defer f.Close()
	}
	log.Printf("AssinaNF %s iniciado: %q", versao, os.Args)

	if len(os.Args) > 1 && strings.HasPrefix(strings.ToLower(os.Args[1]), protocolo+":") {
		if err := assinar(os.Args[1]); err != nil {
			log.Printf("erro: %v", err)
			mensagem(err.Error(), mbIconError)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "--desinstalar" {
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+protocolo+`\shell\open\command`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+protocolo+`\shell\open`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+protocolo+`\shell`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+protocolo)
		mensagem("Assistente de Assinatura removido.", mbIconInfo)
		return
	}
	if err := instalar(); err != nil {
		log.Printf("instalação: %v", err)
		mensagem("Não foi possível instalar: "+err.Error(), mbIconError)
		return
	}
	conexao := "Conexão com o sistema: OK."
	if r, err := requisicao("GET", "https://"+hostsPermitidos[0]+"/api/assinador/teste/pdf", nil, nil); err != nil {
		conexao = "ATENÇÃO: não foi possível falar com o sistema (" + err.Error() + "). Envie o arquivo " + filepath.Join(pastaApp(), "assinanf.log") + " para o suporte."
	} else {
		log.Printf("teste de conexão: %d", r.status)
	}
	mensagem("Assistente de Assinatura instalado (versão "+versao+").\n\n"+conexao+"\n\nVolte ao sistema e clique em \"Assinar no Adobe\".\nSe o navegador perguntar, marque \"Sempre permitir\" e clique em Abrir.", mbIconInfo)
}

// instalar copia o programa para %LOCALAPPDATA%\AssinaNF e registra o endereço assinanf:// para o usuário.
func instalar() error {
	origem, err := os.Executable()
	if err != nil {
		return err
	}
	destino := filepath.Join(pastaApp(), "AssinaNF.exe")
	if !strings.EqualFold(origem, destino) {
		dados, err := os.ReadFile(origem)
		if err != nil {
			return err
		}
		if err := os.WriteFile(destino, dados, 0o755); err != nil {
			return fmt.Errorf("copiar para %s: %w", destino, err)
		}
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+protocolo, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer k.Close()
	_ = k.SetStringValue("", "URL:Assistente de Assinatura NF")
	_ = k.SetStringValue("URL Protocol", "")
	cmd, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+protocolo+`\shell\open\command`, registry.ALL_ACCESS)
	if err != nil {
		return err
	}
	defer cmd.Close()
	return cmd.SetStringValue("", fmt.Sprintf(`"%s" "%%1"`, destino))
}

type resposta struct {
	Ok       bool   `json:"ok"`
	Mensagem string `json:"mensagem"`
}

func assinar(endereco string) error {
	u, err := url.Parse(endereco)
	if err != nil {
		return fmt.Errorf("endereço inválido")
	}
	base := u.Query().Get("u")
	b, err := url.Parse(base)
	if err != nil || b.Host == "" {
		return fmt.Errorf("endereço do documento inválido")
	}
	if !permitido(b) {
		return fmt.Errorf("o endereço %s não é o do sistema de NF; a assinatura foi cancelada por segurança", b.Host)
	}
	// 1. baixa o PDF (pela rede do Windows, com o proxy da organização)
	resp, err := requisicao("GET", base+"/pdf", nil, nil)
	if err != nil {
		return fmt.Errorf("não foi possível baixar o documento: %w", err)
	}
	corpo := resp.corpo
	if resp.status != 200 {
		var r resposta
		_ = json.Unmarshal(corpo, &r)
		return fmt.Errorf("%s", firstNonEmpty(r.Mensagem, fmt.Sprintf("o sistema respondeu %d", resp.status)))
	}
	nome := "documento.pdf"
	if n := resp.nomeArquivo(); n != "" {
		nome = filepath.Base(n)
	}
	pasta := filepath.Join(pastaDocumentos(), "Assinaturas NF")
	if err := os.MkdirAll(pasta, 0o755); err != nil {
		return err
	}
	arquivo := filepath.Join(pasta, nome)
	if err := os.WriteFile(arquivo, corpo, 0o644); err != nil {
		return fmt.Errorf("não foi possível salvar %s (ele está aberto no Adobe? feche e tente de novo): %w", arquivo, err)
	}
	inicio := time.Now()
	log.Printf("baixado %s (%d bytes)", arquivo, len(corpo))

	// 2. abre no Adobe (ou no programa padrão de PDF)
	if err := abrirNoAdobe(arquivo); err != nil {
		return fmt.Errorf("não foi possível abrir o Adobe: %w", err)
	}

	// 3. espera o PDF assinado ser salvo na pasta (mesmo nome ou outro nome)
	tentados := map[string]time.Time{}
	limite := time.Now().Add(espera)
	for time.Now().Before(limite) {
		time.Sleep(2 * time.Second)
		cand := assinadoNaPasta(pasta, inicio, tentados)
		if cand == "" {
			continue
		}
		info, _ := os.Stat(cand)
		tentados[cand] = info.ModTime()
		dados, err := lerQuandoLivre(cand)
		if err != nil {
			continue
		}
		log.Printf("assinado encontrado: %s (%d bytes)", cand, len(dados))

		// 4. envia para o sistema
		r2, err := requisicao("POST", base+"/enviar", map[string]string{"Content-Type": "application/pdf", "X-Nome-Arquivo": url.QueryEscape(filepath.Base(cand))}, dados)
		if err != nil {
			mensagem("Não foi possível enviar o documento assinado ao sistema:\n"+err.Error()+"\n\nVerifique a internet e salve o PDF de novo.", mbIconWarning)
			continue
		}
		var r resposta
		if err := json.Unmarshal(r2.corpo, &r); err != nil {
			r.Mensagem = fmt.Sprintf("resposta inesperada do sistema (%d)", r2.status)
		}
		if !r.Ok {
			log.Printf("recusado: %s", r.Mensagem)
			mensagem("O sistema não aceitou o documento:\n\n"+r.Mensagem+"\n\nCorrija no Adobe e salve de novo; o Assistente continua aguardando.", mbIconWarning)
			continue
		}
		log.Printf("enviado: %s", r.Mensagem)
		fecharNoAdobe(filepath.Base(arquivo), filepath.Base(cand))
		mensagem("Pronto! "+r.Mensagem+"\n\nO documento já está na NF, no sistema.", mbIconInfo)
		return nil
	}
	return fmt.Errorf("o tempo para assinar acabou (45 minutos). Clique em \"Assinar no Adobe\" de novo no sistema")
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func permitido(b *url.URL) bool {
	host := strings.ToLower(b.Hostname())
	extras := []string{}
	if d, err := os.ReadFile(filepath.Join(pastaApp(), "hosts.txt")); err == nil {
		for _, l := range strings.Split(string(d), "\n") {
			if l = strings.TrimSpace(strings.ToLower(l)); l != "" {
				extras = append(extras, l)
			}
		}
	}
	for _, h := range append(hostsPermitidos, extras...) {
		if host == h {
			return b.Scheme == "https" || host == "localhost" || host == "127.0.0.1"
		}
	}
	return false
}

func pastaDocumentos() string {
	if p, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0); err == nil && p != "" {
		return p
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "Documents")
}

// assinadoNaPasta procura um PDF salvo depois do início que contenha assinatura digital (/ByteRange).
func assinadoNaPasta(pasta string, inicio time.Time, tentados map[string]time.Time) string {
	itens, err := os.ReadDir(pasta)
	if err != nil {
		return ""
	}
	melhor, quando := "", time.Time{}
	for _, it := range itens {
		if it.IsDir() || !strings.EqualFold(filepath.Ext(it.Name()), ".pdf") {
			continue
		}
		info, err := it.Info()
		if err != nil || !info.ModTime().After(inicio) {
			continue
		}
		p := filepath.Join(pasta, it.Name())
		if t, ok := tentados[p]; ok && !info.ModTime().After(t) {
			continue
		}
		if info.ModTime().After(quando) {
			melhor, quando = p, info.ModTime()
		}
	}
	if melhor == "" {
		return ""
	}
	if d, err := os.ReadFile(melhor); err != nil || !regexp.MustCompile(`/ByteRange\s*\[\s*0\s+\d+`).Match(d) {
		return ""
	}
	return melhor
}

// lerQuandoLivre espera o Adobe terminar de gravar (tamanho estável e arquivo destravado).
func lerQuandoLivre(p string) ([]byte, error) {
	var ultimo int64 = -1
	for i := 0; i < 15; i++ {
		info, err := os.Stat(p)
		if err == nil && info.Size() == ultimo && info.Size() > 0 {
			if f, err := os.OpenFile(p, os.O_RDWR, 0); err == nil {
				f.Close()
				return os.ReadFile(p)
			}
		}
		if err == nil {
			ultimo = info.Size()
		}
		time.Sleep(1 * time.Second)
	}
	return nil, fmt.Errorf("arquivo ainda em uso")
}

func caminhoAdobe() string {
	for _, exe := range []string{"Acrobat.exe", "AcroRd32.exe"} {
		for _, raiz := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
			k, err := registry.OpenKey(raiz, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\`+exe, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			v, _, err := k.GetStringValue("")
			k.Close()
			if err == nil && v != "" {
				if _, err := os.Stat(strings.Trim(v, `"`)); err == nil {
					return strings.Trim(v, `"`)
				}
			}
		}
	}
	return ""
}

func abrirNoAdobe(arquivo string) error {
	if adobe := caminhoAdobe(); adobe != "" {
		log.Printf("abrindo no Adobe: %s", adobe)
		return exec.Command(adobe, arquivo).Start()
	}
	log.Printf("Adobe não encontrado; abrindo no programa padrão de PDF")
	c := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", arquivo)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return c.Start()
}

// fecharNoAdobe fecha a janela do Adobe que mostra o documento (pelo nome do arquivo no título).
func fecharNoAdobe(nomes ...string) {
	alvos := []string{}
	for _, n := range nomes {
		alvos = append(alvos, strings.ToLower(strings.TrimSuffix(n, filepath.Ext(n))))
	}
	cb := syscall.NewCallback(func(h uintptr, _ uintptr) uintptr {
		if v, _, _ := pIsWindowVisible.Call(h); v == 0 {
			return 1
		}
		buf := make([]uint16, 512)
		n, _, _ := pGetWindowText.Call(h, uintptr(unsafe.Pointer(&buf[0])), 512)
		if n == 0 {
			return 1
		}
		t := strings.ToLower(windows.UTF16ToString(buf[:n]))
		if !strings.Contains(t, "adobe") && !strings.Contains(t, "acrobat") {
			return 1
		}
		for _, a := range alvos {
			if strings.HasPrefix(t, a) {
				log.Printf("fechando janela: %s", t)
				pSetForeground.Call(h)
				pPostMessage.Call(h, wmClose, 0, 0)
				return 0
			}
		}
		return 1
	})
	pEnumWindows.Call(cb, 0)
}
