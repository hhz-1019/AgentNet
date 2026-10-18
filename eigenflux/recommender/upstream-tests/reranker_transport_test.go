package reranker

import (
 "context"
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"
 "time"
)

func TestElsewhereProviderBoundary(t *testing.T) {
 for _, tc := range []struct{name, body string; status int; valid bool}{
  {"complete",`{"results":[{"index":1,"relevance_score":0.9},{"index":0,"relevance_score":0.2}]}`,200,true},
  {"missing",`{"results":[{"index":0,"relevance_score":0.2}]}`,200,false},
  {"duplicate",`{"results":[{"index":0,"relevance_score":0.9},{"index":0,"relevance_score":0.2}]}`,200,false},
  {"outside",`{"results":[{"index":2,"relevance_score":0.9},{"index":0,"relevance_score":0.2}]}`,200,false},
  {"unavailable",`PRIVATE_PROVIDER_BODY`,503,false},
 } {t.Run(tc.name,func(t *testing.T){
  srv:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.WriteHeader(tc.status);w.Write([]byte(tc.body))}));defer srv.Close()
  client:=NewClient("key",srv.URL)
  if client.httpClient.Timeout!=60*time.Second {t.Fatal("provider request has no bound")}
  _,err:=client.Rerank(context.Background(),RerankRequest{Documents:[]string{"one","two"}})
  if (err==nil)!=tc.valid {t.Fatal("incorrect validation",err)}
  if err!=nil && strings.Contains(err.Error(),"PRIVATE_PROVIDER_BODY"){t.Fatal("provider body leaked")}
 })}
}
