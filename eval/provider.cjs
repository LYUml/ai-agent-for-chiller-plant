module.exports = class {
  id(){return 'local-chiller-classifier';}
  async callApi(prompt){
    const {classify}=await import('../src/ai.js');
    return {output:JSON.stringify(await classify(prompt))};
  }
};
