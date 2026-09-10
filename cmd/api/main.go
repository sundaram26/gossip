package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/sundaram26/gossip/internal/config"
	"github.com/sundaram26/gossip/internal/db"
	"github.com/sundaram26/gossip/internal/handlers"
)

func main() {
	cfg := config.MustLoad()
	_, err := db.Connect(cfg.DATABASE_URL)
	if err != nil {
		log.Fatal("main.db.connect: %v", err)
	}

	fmt.Println("Database Connected")
	fmt.Println("Starting Server...")
	
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", handlers.Health)

	fmt.Println("Server is running on http://localhost:" + cfg.Port)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  time.Second * 10,
		WriteTimeout: time.Second * 30,
		IdleTimeout:  time.Second * 60,
	}

	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
