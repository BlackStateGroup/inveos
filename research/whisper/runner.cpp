// First-party research harness. Calls the pinned Whisper C API; no upstream
// examples, audio codecs, network downloader or JSON library are incorporated.
#include "whisper.h"
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
static void require(bool ok) { if (!ok) throw std::runtime_error("Unsupported or malformed bounded PCM fixture"); }
static uint32_t le(const std::vector<unsigned char>& b, size_t p, size_t n) {
    require(n<=4 && p+n<=b.size()); uint32_t v=0;
    for(size_t i=0;i<n;++i) v|=uint32_t(b[p+i])<<(8*i); return v;
}
static bool tag(const std::vector<unsigned char>& b,size_t p,const char* s){
    return p+4<=b.size() && std::string(reinterpret_cast<const char*>(b.data()+p),4)==s;
}
static std::vector<float> pcm(const char* path){
    std::ifstream f(path,std::ios::binary|std::ios::ate);require(bool(f));
    const auto size=f.tellg();require(size>=44 && size<=960044);f.seekg(0);
    std::vector<unsigned char> b(static_cast<size_t>(size));require(bool(f.read(reinterpret_cast<char*>(b.data()),size)));
    // Deliberately only canonical RIFF/WAVE PCM16 mono 16kHz. No codec parsing,
    // unknown chunks, resampling, malformed length tolerance or trailing data.
    require(tag(b,0,"RIFF") && le(b,4,4)+8==b.size() && tag(b,8,"WAVE") && tag(b,12,"fmt ") && le(b,16,4)==16);
    require(le(b,20,2)==1 && le(b,22,2)==1 && le(b,24,4)==16000 && le(b,28,4)==32000 && le(b,32,2)==2 && le(b,34,2)==16);
    require(tag(b,36,"data") && le(b,40,4)==b.size()-44 && (b.size()-44)%2==0 && b.size()>44);
    std::vector<float> samples((b.size()-44)/2);
    for(size_t i=0;i<samples.size();++i){const auto raw=le(b,44+i*2,2);const int value=raw>=32768?int(raw)-65536:int(raw);samples[i]=float(value)/32768.0f;}
    return samples;
}
static std::string json_string(const char* value){
    const std::string text(value?value:"");require(text.size()<=16384);std::string out="\"";
    const char* hex="0123456789abcdef";
    for(unsigned char c:text){if(c=='"'||c=='\\'){out+='\\';out+=char(c);}else if(c<32){out+="\\u00";out+=hex[c>>4];out+=hex[c&15];}else out+=char(c);}
    return out+'"';
}
static void silent_log(enum ggml_log_level,const char*,void*){}
int main(int argc,char** argv){
    try{
        require(argc==3);const auto samples=pcm(argv[2]);whisper_log_set(silent_log,nullptr);
        auto options=whisper_context_default_params();options.use_gpu=false;
        std::unique_ptr<whisper_context,decltype(&whisper_free)> ctx(whisper_init_from_file_with_params(argv[1],options),whisper_free);
        if(!ctx)throw std::runtime_error("Pinned model could not be loaded");
        auto params=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads=1;params.translate=false;params.language="en";params.detect_language=false;
        params.no_context=true;params.print_progress=false;params.print_realtime=false;params.print_timestamps=false;params.print_special=false;
        params.token_timestamps=false;params.temperature=0;params.temperature_inc=0;params.greedy.best_of=1;
        if(whisper_full(ctx.get(),params,samples.data(),int(samples.size()))!=0)throw std::runtime_error("Bounded transcription failed");
        const int n=whisper_full_n_segments(ctx.get());require(n>=0 && n<=128);
        // Preserve reported offsets, including anomalous offsets; the caller
        // validates/flags them rather than silently correcting model output.
        std::cout<<"{\"format\":\"inveos.whisper_research.v1\",\"sampleRate\":16000,\"samples\":"<<samples.size()<<",\"segments\":[";
        for(int i=0;i<n;++i){if(i)std::cout<<',';std::cout<<"{\"startMs\":"<<whisper_full_get_segment_t0(ctx.get(),i)*10<<",\"endMs\":"<<whisper_full_get_segment_t1(ctx.get(),i)*10<<",\"text\":"<<json_string(whisper_full_get_segment_text(ctx.get(),i))<<'}';}
        std::cout<<"]}\n";return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 2;}
}
