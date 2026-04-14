FROM openjdk:21-jdk-alpine
VOLUME /tmp
ARG JAVA_OPTS
ENV JAVA_OPTS=$JAVA_OPTS
COPY aitradingagent.jar aitradingagent.jar
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar aitradingagent.jar"]
# For Spring-Boot project, use the entrypoint below to reduce Tomcat startup time.
#ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -Djava.security.egd=file:/dev/./urandom -jar aitradingagent.jar"]
