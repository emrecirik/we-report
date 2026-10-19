package dev.wereport.backend;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** we-report data backend — Spring Boot implementation of protocol/openapi.yaml (v1). */
@SpringBootApplication
public class WeReportBackendApplication {
  private static final BackendConfig CONFIG = BackendConfig.fromEnvironment(System.getenv());

  public static void main(String[] args) {
    if (!CONFIG.isLoopback() && CONFIG.authToken() == null && !CONFIG.demo()) {
      System.err.println("Refusing to listen on " + CONFIG.host() + " without authentication. Set WE_REPORT_AUTH_TOKEN, "
          + "plug your own auth into the filter in WeReportBackendApplication, or keep WE_REPORT_HOST=127.0.0.1.");
      System.exit(1);
    }
    System.setProperty("server.address", CONFIG.host().equals("localhost") ? "127.0.0.1" : CONFIG.host());
    System.setProperty("server.port", String.valueOf(CONFIG.port()));
    System.setProperty("spring.main.banner-mode", "off");
    System.setProperty("logging.level.root", "WARN");
    SpringApplication.run(WeReportBackendApplication.class, args);
  }

  @Bean
  BackendConfig backendConfig() {
    return CONFIG;
  }

  @Bean
  WebMvcConfigurer cors() {
    return new WebMvcConfigurer() {
      @Override
      public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/v1/**")
            .allowedOrigins(CONFIG.corsOrigins().toArray(String[]::new))
            .allowedMethods("GET", "POST")
            .allowedHeaders("Content-Type", "Authorization")
            .maxAge(600);
      }
    };
  }

  /**
   * Who may call, and how often. Without a token only local callers are accepted — unless this is
   * the public demo, which serves read-only sample data to anyone. Replace with Spring Security
   * (session, JWT …) if your application already has it.
   */
  @Bean
  OncePerRequestFilter accessFilter() {
    Map<String, AtomicInteger> hits = new ConcurrentHashMap<>();
    return new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if ("OPTIONS".equals(req.getMethod())) {
          chain.doFilter(req, res);
          return;
        }
        long minute = System.currentTimeMillis() / 60000;
        String key = req.getRemoteAddr() + "|" + minute;
        if (hits.size() > 10000) hits.keySet().removeIf(k -> !k.endsWith("|" + minute));
        if (hits.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet() > CONFIG.rateLimitPerMinute()) {
          error(res, 429, "Too many requests; try again in a minute.");
          return;
        }
        boolean allowed;
        if (CONFIG.authToken() != null) allowed = ("Bearer " + CONFIG.authToken()).equals(req.getHeader("Authorization"));
        else if (CONFIG.demo()) allowed = true;
        else {
          // Local only — and addressed as a local host, so a page whose domain was re-pointed at
          // 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
          String host = req.getServerName().replaceAll("^\\[|\\]$", "");
          boolean localName = host.equals("localhost") || (host.matches("[0-9.:a-fA-F]+") && InetAddress.getByName(host).isLoopbackAddress());
          allowed = localName && InetAddress.getByName(req.getRemoteAddr()).isLoopbackAddress();
        }
        if (!allowed) {
          error(res, 401, "Not authorized.");
          return;
        }
        if (req.getContentLengthLong() > MAX_BODY) {
          error(res, 413, "Request body too large.");
          return;
        }
        chain.doFilter(new LimitedRequest(req), res);
      }
    };
  }

  private static final int MAX_BODY = 1024 * 1024;

  /** Caps the request body, chunked ones included (they have no Content-Length to check up front). */
  private static final class LimitedRequest extends jakarta.servlet.http.HttpServletRequestWrapper {
    LimitedRequest(HttpServletRequest request) {
      super(request);
    }

    @Override
    public jakarta.servlet.ServletInputStream getInputStream() throws IOException {
      jakarta.servlet.ServletInputStream in = super.getInputStream();
      return new jakarta.servlet.ServletInputStream() {
        private long count;

        @Override
        public int read() throws IOException {
          int b = in.read();
          if (b != -1 && ++count > MAX_BODY) throw new ApiError(413, "Request body too large.");
          return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
          int n = in.read(buf, off, len);
          if (n > 0 && (count += n) > MAX_BODY) throw new ApiError(413, "Request body too large.");
          return n;
        }

        @Override
        public boolean isFinished() {
          return in.isFinished();
        }

        @Override
        public boolean isReady() {
          return in.isReady();
        }

        @Override
        public void setReadListener(jakarta.servlet.ReadListener listener) {
          in.setReadListener(listener);
        }
      };
    }
  }

  private static void error(HttpServletResponse res, int status, String message) throws IOException {
    res.setStatus(status);
    res.setContentType("application/json");
    res.getWriter().write("{\"error\":\"" + message.replace("\"", "\\\"") + "\"}");
  }

  @EventListener(ApplicationReadyEvent.class)
  void ready() {
    System.out.println("we-report backend on http://" + CONFIG.host() + ":" + CONFIG.port() + " - connections: "
        + String.join(", ", CONFIG.connections().stream().map(c -> c.id() + " (" + c.dialect() + ")").toList())
        + (CONFIG.demo() ? " - DEMO MODE" : ""));
  }
}
